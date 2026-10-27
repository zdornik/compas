import {createHmac,timingSafeEqual} from 'node:crypto';
import {unseal} from './crypto.mjs';
import {dayKey} from '../src/domain.js';
import {addDays} from '../src/medications.js';
import {currentMedicationRows} from '../src/current-medications.js';
import {trackingSnapshot} from '../src/tracking.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const normalize=value=>value.toLocaleLowerCase('ru').replaceAll('ё','е');
export function rosterOptions(params){
 const filters=Object.fromEntries(['q','letter','diagnosis','medication'].map(name=>[name,(params.get(name)||'').trim()]));
 const before=params.get('before'),limit=Number(params.get('limit')||20);
 if(Object.values(filters).some(value=>value.length>120)||filters.letter.length>1||before?.length>500||!Number.isInteger(limit)||limit<1||limit>50)fail('Проверьте фильтры пациентов');
 return {...filters,before,limit};
}
const sign=(key,scope,body)=>createHmac('sha256',key).update('care-roster-v1:'+scope+':'+body).digest('base64url');
export async function readPatientTracking(db,patientId,decode){
 const today=dayKey(),rows=(await db.query(`
 SELECT id,payload FROM patient_entries WHERE patient_id=$1 AND (type='medication-plan' OR (observation_day>=$2::date AND type IN ('mood','sleep','medication-dose')))
 UNION ALL (SELECT id,payload FROM patient_entries WHERE patient_id=$1 AND type='assessment' ORDER BY saved_at DESC,id DESC LIMIT 20)`,[patientId,addDays(today,-13)])).rows;
 return trackingSnapshot(rows.map(row=>decode(row,patientId)),today);
}
export async function readCareRoster(db,session,params,key,decode){
 if(session.account_role!=='doctor'||!session.account_id)fail('Войдите в аккаунт врача',403);
 const options=rosterOptions(params),scope=JSON.stringify([session.patient_id,options.q,options.letter,options.diagnosis,options.medication]);
 let cursor=null;
 if(options.before){
  const [body,mac,...extra]=options.before.split('.'),expected=sign(key,scope,body);
  if(extra.length||!mac||Buffer.byteLength(mac)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))fail('Страница пациентов недействительна');
  cursor=Buffer.from(body,'base64url').toString();if(!uuid(cursor))fail('Страница пациентов недействительна');
 }
 await db.query("SELECT set_config('app.actor_id',$1,true)",[session.patient_id]);
 const own=(await db.query('SELECT id,payload FROM auth_accounts WHERE id=$1 AND principal_id=$2 FOR SHARE',[session.account_id,session.patient_id])).rows[0];
 if(!own||unseal(own.payload,key,'auth-account:'+own.id).consents.healthData!==true)fail('Согласие на обработку данных отозвано',403);
 const candidates=(await db.query("SELECT * FROM care_links WHERE doctor_id=$1 AND status='active' AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 101",[session.patient_id,cursor])).rows;
 const batch=candidates.slice(0,100),ids=batch.map(row=>row.id),patients=[...new Set(batch.map(row=>row.patient_id))].sort();
 if(!batch.length)return {items:[],nextCursor:null,assessmentWindow:20};
 await db.query('SELECT id FROM local_patients WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[patients]);
 const links=(await db.query("SELECT * FROM care_links WHERE id=ANY($1::uuid[]) AND doctor_id=$2 AND status='active' ORDER BY id FOR SHARE",[ids,session.patient_id])).rows;
 await db.query("SELECT set_config('app.roster_doctor',$1,true)",[session.patient_id]);
 // Patient rows above serialize consent updates; FOR SHARE on accounts would require a wider UPDATE policy.
 const accounts=(await db.query('SELECT id,principal_id,payload FROM auth_accounts WHERE principal_id=ANY($1::uuid[]) ORDER BY principal_id',[links.map(row=>row.patient_id)])).rows;
 const permissions=new Map(accounts.map(row=>[row.principal_id,unseal(row.payload,key,'auth-account:'+row.id).consents.healthData===true]));
 const allowed=links.filter(row=>permissions.get(row.patient_id)===true).map(row=>row.patient_id),today=dayKey();
 const records=allowed.length?(await db.query(`
 SELECT patient_id,id,type,payload FROM patient_entries WHERE patient_id=ANY($1::uuid[]) AND (type IN ('medical-profile','medication-plan') OR (observation_day>=$2::date AND type IN ('mood','sleep','medication-dose')))
 UNION ALL SELECT e.patient_id,e.id,e.type,e.payload FROM unnest($1::uuid[]) patient(id) CROSS JOIN LATERAL (SELECT patient_id,id,type,payload FROM patient_entries WHERE patient_id=patient.id AND type='assessment' ORDER BY saved_at DESC,id DESC LIMIT 20) e`,[allowed,addDays(today,-13)])).rows:[];
 const byPatient=new Map(allowed.map(id=>[id,[]]));for(const row of records)byPatient.get(row.patient_id)?.push(decode(row,row.patient_id));
 const byLink=new Map(links.map(row=>[row.id,row])),items=[];let lastScanned=cursor,scanned=0;
 for(const candidate of batch){
  scanned++;lastScanned=candidate.id;const row=byLink.get(candidate.id);if(!row)continue;
  const names=unseal(row.payload,key,'care-link:'+row.id),entries=byPatient.get(row.patient_id),profile=entries?.find(entry=>entry.type==='medical-profile');
  const medications=entries?currentMedicationRows(entries,profile,today).map(item=>({name:item.name,productId:item.productId||null})):[];
  const conditions=profile?.conditions?.map(item=>({name:item.name,code:item.icd10||null}))||[];
  if(options.q&&!normalize(names.patientName).includes(normalize(options.q)))continue;
  if(options.letter&&!normalize(names.patientName).startsWith(normalize(options.letter)))continue;
  if(options.diagnosis&&!conditions.some(item=>normalize(item.name+' '+(item.code||'')).includes(normalize(options.diagnosis))))continue;
  if(options.medication&&!medications.some(item=>normalize(item.name).includes(normalize(options.medication))))continue;
  items.push({id:row.id,patientName:names.patientName,status:entries?'active':'restricted',medications,conditions,tracking:entries?trackingSnapshot(entries,today):null});
  if(items.length===options.limit)break;
 }
 const body=lastScanned?Buffer.from(lastScanned).toString('base64url'):null;
 return {items,nextCursor:body&&(scanned<batch.length||candidates.length>100)?body+'.'+sign(key,scope,body):null,assessmentWindow:20};
}
