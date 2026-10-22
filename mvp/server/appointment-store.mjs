import {randomUUID} from 'node:crypto';
import {seal,unseal} from './crypto.mjs';
import {readPatientConsent} from './auth-store.mjs';
import {appointmentUuid,appointmentInput,appointmentFuture,appointmentAction,appointmentHash} from './appointment-policy.mjs';

const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
const context=id=>'care-appointment:'+id;
const view=(row,key)=>({...unseal(row.payload,key,context(row.id)),id:row.id,linkId:row.link_id,startsAt:new Date(row.starts_at).toISOString(),endsAt:new Date(row.ends_at).toISOString(),status:row.status,revision:row.revision,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()});
async function event(db,row,key,action,actorId,mutation){
 const id=randomUUID();
 await db.query('INSERT INTO care_appointment_events(id,appointment_id,revision,actor_id,mutation_id,request_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,row.id,row.revision,actorId,mutation?.mutationId||null,mutation?.hash||null,seal({action,appointment:view(row,key)},key,'appointment-event:'+id)]);
}
// Called while holding the patient lock, before revoking the link/health consent.
export async function cancelAccessAppointments(db,patientId,key,{linkId=null,reason='health_consent_revoked'}={}){
 const rows=(await db.query("SELECT * FROM care_appointments WHERE patient_id=$1 AND ($2::uuid IS NULL OR link_id=$2) AND status IN ('requested','confirmed') AND ends_at>now() ORDER BY id FOR UPDATE",[patientId,linkId])).rows;
 for(const row of rows){
  const saved=(await db.query("UPDATE care_appointments SET status='cancelled',revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[row.id])).rows[0];
  await event(db,saved,key,reason,patientId);
 }
}

export function createAppointmentStore({transaction,key}){
 const identity=session=>{
  if(!session?.account_id||!['patient','doctor'].includes(session.account_role))fail('Для записи на приём войдите в учётную запись',401);
  return session.account_role;
 };
 const actor=(db,id)=>db.query("SELECT set_config('app.actor_id',$1,true)",[id]);
 const authorize=async(db,session,linkId)=>{
  let link=(await db.query('SELECT * FROM care_links WHERE id=$1',[linkId])).rows[0];
  if(!link||![link.patient_id,link.doctor_id].includes(session.patient_id))fail('Подключение не найдено',404);
  // All appointment mutations acquire both principals in the same global order.
  await db.query('SELECT id FROM local_patients WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[link.patient_id,link.doctor_id]]);
  link=(await db.query('SELECT * FROM care_links WHERE id=$1 FOR UPDATE',[linkId])).rows[0];
  const role=identity(session),expected=role==='doctor'?link?.doctor_id:link?.patient_id;
  if(expected!==session.patient_id||link.status!=='active'||(role==='doctor'&&!session.doctor_enabled))fail('Подключение с врачом не активно',403);
  await db.query("SELECT set_config('app.patient_id',$1,true)",[link.patient_id]);
  const patientAccount=(await db.query('SELECT role FROM auth_accounts WHERE principal_id=$1',[link.patient_id])).rows[0];
  // Read only the linked principal's fixed role, then restore the patient scope.
  await db.query("SELECT set_config('app.patient_id',$1,true)",[link.doctor_id]);
  const doctorAccount=(await db.query('SELECT role FROM auth_accounts WHERE principal_id=$1',[link.doctor_id])).rows[0];
  await db.query("SELECT set_config('app.patient_id',$1,true)",[link.patient_id]);
  if(patientAccount?.role!=='patient'||doctorAccount?.role!=='doctor')fail('Для записи на приём нужны зарегистрированные аккаунты пациента и врача',403);
  if((await readPatientConsent(db,link.patient_id,key)).healthData!==true)fail('Согласие пациента на обработку данных отозвано',403);
  return {link,role};
 };
 const conflict=error=>{
  if(error.code==='23P01')fail('Это время уже занято у врача или пациента. Выберите другое время',409);
  if(error.code==='23505')fail('Идентификатор приёма уже использован. Обновите список',409);
  throw error;
 };
 return {
  async list(session,page){
   const role=identity(session);
   return transaction(null,async db=>{
    await actor(db,session.patient_id);
    const rows=(await db.query(`SELECT * FROM care_appointments WHERE ${role==='doctor'?'doctor_id':'patient_id'}=$1 AND ends_at>$2 AND starts_at<$3 AND ($4::text IS NULL OR status=$4) AND ($5::timestamptz IS NULL OR (starts_at,id)>($5::timestamptz,$6::uuid)) ORDER BY starts_at,id LIMIT $7`,[session.patient_id,page.from,page.to,page.status,page.after?.at||null,page.after?.id||null,page.limit+1])).rows;
    const patientIds=[...new Set(rows.map(row=>row.patient_id))].sort();
    if(role==='doctor'&&patientIds.length)await db.query('SELECT id FROM local_patients WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[patientIds]);
    const consents=new Map(),visible=[];
    for(const row of rows){
     if(role==='doctor'){
      await db.query("SELECT set_config('app.patient_id',$1,true)",[row.patient_id]);
      if(!consents.has(row.patient_id))consents.set(row.patient_id,(await readPatientConsent(db,row.patient_id,key)).healthData===true);
      if(!consents.get(row.patient_id))continue;
      const link=(await db.query("SELECT id FROM care_links WHERE id=$1 AND status='active'",[row.link_id])).rows[0];if(!link)continue;
     }
     visible.push(row);
    }
    const chunk=visible.slice(0,page.limit),last=chunk.at(-1);
    return {items:chunk.map(row=>view(row,key)),nextAfter:visible.length>page.limit&&last?Buffer.from(JSON.stringify({at:new Date(last.starts_at).toISOString(),id:last.id})).toString('base64url'):null};
   });
  },
  async create(session,input){
   identity(session);const value=appointmentInput(input),hash=appointmentHash(key,value);
   try{return await transaction(null,async db=>{
    await actor(db,session.patient_id);const {link,role}=await authorize(db,session,value.linkId);
    const existing=(await db.query('SELECT * FROM care_appointments WHERE id=$1',[value.id])).rows[0];
    if(existing){if(existing.created_by!==session.patient_id||existing.request_hash!==hash)fail('Идентификатор приёма уже использован',409);return view(existing,key);}
    appointmentFuture(value.startsAt);
    const names=unseal(link.payload,key,'care-link:'+link.id),payload=seal({patientName:names.patientName,doctorName:names.doctorName,format:value.format,note:value.note,createdByRole:role},key,context(value.id));
    const endsAt=new Date(Date.parse(value.startsAt)+value.durationMinutes*60000).toISOString();
    const row=(await db.query('INSERT INTO care_appointments(id,link_id,patient_id,doctor_id,starts_at,ends_at,status,created_by,request_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[value.id,link.id,link.patient_id,link.doctor_id,value.startsAt,endsAt,role==='doctor'?'confirmed':'requested',session.patient_id,hash,payload])).rows[0];
    await event(db,row,key,role==='doctor'?'scheduled':'requested',session.patient_id);
    return view(row,key);
   });}catch(error){return conflict(error);}
  },
  async change(session,id,action,input){
   identity(session);if(!appointmentUuid(id))fail('Приём не найден',404);
   const value=appointmentAction(input,action),hash=appointmentHash(key,{id,...value});
   try{return await transaction(null,async db=>{
    await actor(db,session.patient_id);
    let row=(await db.query('SELECT * FROM care_appointments WHERE id=$1',[id])).rows[0];if(!row)fail('Приём не найден',404);
    const {role}=await authorize(db,session,row.link_id);
    row=(await db.query('SELECT * FROM care_appointments WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(action!=='cancel'&&role!=='doctor')fail('Подтвердить или отклонить запрос может только врач',403);
    const receipt=(await db.query('SELECT request_hash,actor_id FROM care_appointment_events WHERE appointment_id=$1 AND mutation_id=$2',[id,value.mutationId])).rows[0];
    if(receipt){if(receipt.actor_id!==session.patient_id||receipt.request_hash!==hash)fail('Идентификатор действия уже использован',409);return view(row,key);}
    if(row.revision!==value.expectedRevision)fail('Приём изменён в другом окне. Обновите список',409);
    const target={confirm:'confirmed',decline:'declined',cancel:'cancelled'}[action];
    if((action==='cancel'&&!['requested','confirmed'].includes(row.status))||(action!=='cancel'&&row.status!=='requested'))fail('Статус приёма уже изменился. Обновите список',409);
    if(action==='confirm')appointmentFuture(new Date(row.starts_at).toISOString());
    if(action==='cancel'&&new Date(row.ends_at).getTime()<=Date.now())fail('Завершившийся приём нельзя отменить',409);
    const saved=(await db.query('UPDATE care_appointments SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',[id,target])).rows[0];
    await event(db,saved,key,action,session.patient_id,{mutationId:value.mutationId,hash});return view(saved,key);
   });}catch(error){return conflict(error);}
  },
 };
}
