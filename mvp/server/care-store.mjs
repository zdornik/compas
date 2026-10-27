import {randomUUID,randomBytes} from 'node:crypto';
import {seal,unseal,tokenHash} from './crypto.mjs';
import {makeMedicationPlan,normalizeMedicationConfig} from '../src/medications.js';
import {prescriptionSafety} from './prescription-safety.mjs';
import {makeMedicalProfile} from '../src/medical-profile.js';
import {canonicalMedicalInput} from './medical-reference.mjs';
import {readPatientConsent} from './auth-store.mjs';
import {cancelAccessAppointments} from './appointment-store.mjs';
import {coreEntries,entryHistory} from './history.mjs';
import {readCareRoster,readPatientTracking} from './care-roster.mjs';
import {listClinicalNotes,saveClinicalNote} from './clinical-notes.mjs';
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
const label=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>100)fail('Укажите имя до 100 символов');return value.trim();};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const checkedConfig=input=>{try{return normalizeMedicationConfig(input);}catch(error){error.status=error.status||422;throw error;}};
export function createCareStore({transaction,key,decode}) {
 const actor=async(db,id)=>db.query("SELECT set_config('app.actor_id',$1,true)",[id]);
 const rows=async(db,patientId)=>(await db.query("SELECT id,payload FROM patient_entries WHERE type IN ('medical-profile','medication-plan') ORDER BY saved_at DESC,id")).rows.map(row=>decode(row,patientId));
 const patientConsent=(db,patientId)=>readPatientConsent(db,patientId,key);
 const openLink=async(db,session,id,doctor=true,write=true)=>{
  if(!uuid(id))fail('Подключение не найдено',404);
  await actor(db,session.patient_id);
  let row=(await db.query('SELECT * FROM care_links WHERE id=$1',[id])).rows[0];
  if(row){await db.query('SELECT id FROM local_patients WHERE id=$1 FOR '+(write?'UPDATE':'SHARE'),[row.patient_id]);row=(await db.query('SELECT * FROM care_links WHERE id=$1 FOR '+(write?'UPDATE':'SHARE'),[id])).rows[0];}
  if(!row||(doctor?row.doctor_id!==session.patient_id:row.patient_id!==session.patient_id))fail('Подключение не найдено',404);
  if(doctor&&(!session.doctor_enabled||row.status!=='active'))fail('Пациент не предоставил доступ или отозвал его',403);
  return row;
 };
 const linkView=(row,viewer)=>({id:row.id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,...(viewer===row.patient_id||row.status==='active'?unseal(row.payload,key,'care-link:'+row.id):{patientName:'Ожидает подтверждения пациента'})});
 const audit=async(db,link,action,payload)=>{const id=randomUUID();await db.query('INSERT INTO care_audit(id,patient_id,doctor_id,link_id,action,payload) VALUES($1,$2,$3,$4,$5,$6)',[id,link.patient_id,link.doctor_id,link.id,action,seal(payload,key,'care-audit:'+id)]);};
 const authorized=async(session,id,callback,{write=true}={})=>transaction(null,async db=>{const link=await openLink(db,session,id,true,write);await db.query("SELECT set_config('app.patient_id',$1,true)",[link.patient_id]);if((await patientConsent(db,link.patient_id)).healthData!==true)fail('Пациент отозвал согласие на обработку данных',403);return callback(db,link);});
 return {
  async roster(session,params){return transaction(null,db=>readCareRoster(db,session,params,key,decode));},
  async clinicalNotes(session,id,params){
   if(session.account_role!=='doctor'||!session.account_id)fail('Войдите в аккаунт врача',403);
   return authorized(session,id,async(db,link)=>{if((await patientConsent(db,session.patient_id)).healthData!==true)fail('Согласие на обработку данных отозвано',403);return listClinicalNotes(db,link,session,params,key);},{write:false});
  },
  async saveClinicalNote(session,id,input){
   if(session.account_role!=='doctor'||!session.account_id)fail('Войдите в аккаунт врача',403);
   return authorized(session,id,async(db,link)=>{if((await patientConsent(db,session.patient_id)).healthData!==true)fail('Согласие на обработку данных отозвано',403);const note=await saveClinicalNote(db,link,session,input,key);await audit(db,link,'clinical_note_save',{id:note.id,revision:note.revision});return note;});
  },
  async doctor(session,name){if(session.account_role&&session.account_role!=='doctor')fail('Роль аккаунта изменять нельзя',403);return transaction(null,async db=>{await actor(db,session.patient_id);const existing=(await db.query('SELECT payload FROM care_doctors WHERE id=$1',[session.patient_id])).rows[0];const doctorName=name?label(name):existing?unseal(existing.payload,key,'doctor:'+session.patient_id).name:fail('Введите имя врача');await db.query('INSERT INTO care_doctors(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload',[session.patient_id,seal({name:doctorName},key,'doctor:'+session.patient_id)]);await db.query('UPDATE app_sessions SET doctor_enabled=true WHERE token_hash=$1',[session.token_hash]);return {name:doctorName};});},
  async links(session){return transaction(null,async db=>{await actor(db,session.patient_id);const found=(await db.query('SELECT * FROM care_links ORDER BY created_at DESC')).rows;const doctor=(await db.query('SELECT payload FROM care_doctors WHERE id=$1',[session.patient_id])).rows[0];const profile=(await db.query('SELECT payload FROM care_patient_profiles WHERE patient_id=$1',[session.patient_id])).rows[0];return {profile:profile?unseal(profile.payload,key,'patient-profile:'+session.patient_id):null,patientLinks:found.filter(row=>row.patient_id===session.patient_id).map(row=>linkView(row,session.patient_id)),doctorLinks:session.doctor_enabled?found.filter(row=>row.doctor_id===session.patient_id).map(row=>linkView(row,session.patient_id)):[],doctor:doctor?unseal(doctor.payload,key,'doctor:'+session.patient_id):null,localPrototype:true};});},
  async invite(session,name){return transaction(null,async db=>{await actor(db,session.patient_id);const code=randomBytes(12).toString('hex').toUpperCase(),hash=tokenHash(code);await db.query('UPDATE care_invites SET used_at=now() WHERE patient_id=$1 AND used_at IS NULL',[session.patient_id]);const result=await db.query("INSERT INTO care_invites(token_hash,patient_id,payload,expires_at) VALUES($1,$2,$3,now()+interval '15 minutes') RETURNING expires_at",[hash,session.patient_id,seal({patientName:label(name)},key,'care-invite:'+hash)]);return {code,expiresAt:result.rows[0].expires_at};});},
  async profile(session,name){return transaction(null,async db=>{await actor(db,session.patient_id);await db.query('SELECT id FROM local_patients WHERE id=$1 FOR UPDATE',[session.patient_id]);const old=(await db.query('SELECT payload FROM care_patient_profiles WHERE patient_id=$1',[session.patient_id])).rows[0];const previous=old?unseal(old.payload,key,'patient-profile:'+session.patient_id):null;const profile={name:label(name||previous?.name||'Пациент'),code:previous?.code||randomBytes(6).toString('hex').toUpperCase()};await db.query('INSERT INTO care_patient_profiles(patient_id,code_hash,payload) VALUES($1,$2,$3) ON CONFLICT(patient_id) DO UPDATE SET payload=EXCLUDED.payload',[session.patient_id,tokenHash(profile.code),seal(profile,key,'patient-profile:'+session.patient_id)]);if(previous&&previous.name!==profile.name){for(const link of (await db.query("SELECT * FROM care_links WHERE patient_id=$1 AND status IN ('active','pending') FOR UPDATE",[session.patient_id])).rows){const names=unseal(link.payload,key,'care-link:'+link.id);await db.query('UPDATE care_links SET payload=$2,updated_at=now() WHERE id=$1',[link.id,seal({...names,patientName:profile.name},key,'care-link:'+link.id)]);}}return profile;});},
  async claim(session,code){if(!session.doctor_enabled)fail('Сначала откройте локальный профиль врача',403);const normalized=String(code||'').replace(/[\s-]/g,'').toUpperCase();if(!/^(?:[A-F0-9]{12}|[A-F0-9]{24})$/.test(normalized))fail('Проверьте код пациента');return transaction(null,async db=>{
   await actor(db,session.patient_id);const hash=tokenHash(normalized);await db.query("SELECT set_config('app.invite_hash',$1,true)",[hash]);
   const persistent=normalized.length===12?(await db.query('SELECT * FROM care_patient_profiles WHERE code_hash=$1 FOR UPDATE',[hash])).rows[0]:null;
   const invitation=persistent||(await db.query('SELECT * FROM care_invites WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[hash])).rows[0];
   if(!invitation)fail('Код не найден или истёк',404);if(invitation.patient_id===session.patient_id)fail('Откройте кабинет врача через выбор роли. Нельзя подключить профиль к самому себе');
   const existing=(await db.query("SELECT id FROM care_links WHERE patient_id=$1 AND doctor_id=$2 AND status IN ('pending','active')",[invitation.patient_id,session.patient_id])).rows[0];if(existing)fail('Запрос этому пациенту уже создан',409);
   const doctor=(await db.query('SELECT payload FROM care_doctors WHERE id=$1',[session.patient_id])).rows[0];const id=randomUUID(),patient=persistent?{patientName:unseal(persistent.payload,key,'patient-profile:'+persistent.patient_id).name}:unseal(invitation.payload,key,'care-invite:'+hash),payload={...patient,doctorName:unseal(doctor.payload,key,'doctor:'+session.patient_id).name};
   const link=(await db.query("INSERT INTO care_links(id,patient_id,doctor_id,status,payload) VALUES($1,$2,$3,'pending',$4) RETURNING *",[id,invitation.patient_id,session.patient_id,seal(payload,key,'care-link:'+id)])).rows[0];if(!persistent)await db.query('UPDATE care_invites SET used_at=now() WHERE token_hash=$1',[hash]);await audit(db,link,'request',{});return linkView(link,session.patient_id);
  });},
  async consent(session,id,status){if(!['active','revoked'].includes(status))fail('Некорректное согласие');return transaction(null,async db=>{const link=await openLink(db,session,id,false);if(link.status==='revoked'&&status==='active')fail('Создайте новое подключение',409);if(status==='revoked')await cancelAccessAppointments(db,link.patient_id,key,{linkId:id,reason:'connection_revoked'});await db.query('UPDATE care_links SET status=$2,updated_at=now() WHERE id=$1',[id,status]);await audit(db,link,status==='active'?'consent':'revoke',{});return {id,status};});},
  async patient(session,id){return authorized(session,id,async(db,link)=>{
   const consents=await patientConsent(db,link.patient_id),journalShared=consents.journalProcessing===true&&consents.journalSharing===true;
   const account=(await db.query('SELECT id,payload FROM auth_accounts WHERE principal_id=$1',[link.patient_id])).rows[0],profile=account?unseal(account.payload,key,'auth-account:'+account.id).profile:null;
   const entries=(await coreEntries(db,link.patient_id,decode)).map(row=>!journalShared&&['mood','sleep'].includes(row.type)?{...row,note:''}:row);
   return {link:linkView(link,session.patient_id),entries,journalShared,profile,historyAvailable:true,trackingDoctorId:session.patient_id,tracking:await readPatientTracking(db,link.patient_id,decode,session.patient_id)};
  },{write:false});},
  async history(session,id,options){return authorized(session,id,async(db,link)=>{
   if(options.kind==='notes')fail('Используйте раздел заметок',400);
   const consents=await patientConsent(db,link.patient_id),shared=consents.journalProcessing===true&&consents.journalSharing===true;
   // Recheck sharing and return a freshly redacted window even when entries did not change.
   const result=await entryHistory(db,link.patient_id,{...options,since:null},{key,decode,redact:row=>!shared&&['mood','sleep'].includes(row.type)?{...row,note:''}:row});
   return result;
  },{write:false});},
  async medicalProfile(session,id,input){return authorized(session,id,async(db,link)=>{
   const entries=await rows(db,link.patient_id),old=entries.find(row=>row.type==='medical-profile'),names=unseal(link.payload,key,'care-link:'+link.id);
   let record;try{record=makeMedicalProfile(await canonicalMedicalInput(db,input),old||null,new Date(),{type:'doctor',name:names.doctorName,actorId:session.patient_id});}catch(error){error.status=error.status||422;throw error;}
   await db.query('INSERT INTO patient_entries(patient_id,id,type,observation_day,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(patient_id,id) DO UPDATE SET payload=EXCLUDED.payload,observation_day=EXCLUDED.observation_day,saved_at=now()',[link.patient_id,record.id,record.type,record.day,seal(record,key,`${link.patient_id}:${record.id}`)]);
   await audit(db,link,'medical_profile_edit',{revision:record.revision,previousRevision:old?.revision||0});return record;
  });},
  async archiveMedication(session,id,planId,input){return authorized(session,id,async(db,link)=>{
   const old=(await rows(db,link.patient_id)).find(row=>row.id===planId&&row.type==='medication-plan');if(!old)fail('Схема не найдена',404);
   const names=unseal(link.payload,key,'care-link:'+link.id),record={...old,...makeMedicationPlan({...old,expectedRevision:input.expectedRevision,archived:true},old.id,old),lastChangedBy:{type:'doctor',name:names.doctorName,action:'archived',at:new Date().toISOString()}};
   await db.query('UPDATE patient_entries SET payload=$2,saved_at=now() WHERE id=$1',[old.id,seal(record,key,`${link.patient_id}:${old.id}`)]);await audit(db,link,'archive_medication',{planId,revision:record.revision});return record;
  });},
  async check(session,id,input){if(!input.plan||input.plan.id!==input.planId)fail('Передайте схему для проверки');const proposedConfig=checkedConfig({...input.plan,productId:input.productId||null});return authorized(session,id,async(db,link)=>prescriptionSafety(db,{entries:await rows(db,link.patient_id),productId:input.productId,documentId:input.documentId,excludePlanId:input.planId||null,proposedConfig}));},
  async prescribe(session,id,input){return authorized(session,id,async(db,link)=>{
   const draft=input.plan;if(!draft||typeof draft.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(draft.id))fail('Некорректная схема');
   const entries=await rows(db,link.patient_id),old=entries.find(row=>row.id===draft.id);
   if(old&&(old.type!=='medication-plan'||old.origin!=='doctor'||old.prescriberId!==session.patient_id))fail('Вы не можете изменять эту схему',403);
   if(old&&(old.productId!==(input.productId||null)||old.instructionDocumentId!==(input.documentId||null)))fail('Для смены препарата или исходной инструкции создайте новое назначение');
   const config=checkedConfig({...draft,productId:input.productId||null});
   if(old&&JSON.stringify(config)===JSON.stringify(normalizeMedicationConfig(old))&&old.productId===(input.productId||null)&&old.instructionDocumentId===(input.documentId||null))return old;
   const report=await prescriptionSafety(db,{entries,productId:input.productId,documentId:input.documentId,excludePlanId:draft.id,proposedConfig:config});
   if(input.reviewedFingerprint!==report.fingerprint)fail('Сведения пациента или источника изменились. Повторите проверку перед отправкой',409);
   if(input.acknowledged!==true)fail('Подтвердите ручную проверку назначения');
   if(report.candidate&&config.name!==report.candidate.name)fail('Название должно соответствовать выбранному препарату из реестра');
   const plan=makeMedicationPlan({...draft,productId:input.productId||null},draft.id,old||null),names=unseal(link.payload,key,'care-link:'+link.id);
   const saved={...plan,origin:'doctor',prescriberId:session.patient_id,prescriberName:names.doctorName,careLinkId:link.id,productId:input.productId||null,instructionDocumentId:input.documentId||null,delivery:{status:'available',at:new Date().toISOString()},safetyReview:{...report,acknowledgedAt:new Date().toISOString(),manualReview:true}};
   await db.query('INSERT INTO patient_entries(patient_id,id,type,observation_day,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(patient_id,id) DO UPDATE SET payload=EXCLUDED.payload,saved_at=now()',[link.patient_id,saved.id,saved.type,saved.day,seal(saved,key,`${link.patient_id}:${saved.id}`)]);
   await audit(db,link,'prescribe',{planId:saved.id,revision:saved.revision,fingerprint:report.fingerprint});return saved;
  });},
 };
}
