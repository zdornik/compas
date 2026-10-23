import {randomUUID} from 'node:crypto';
import {seal,unseal} from './crypto.mjs';
import {validateEntry} from './validation.mjs';
import {readPatientConsent} from './auth-store.mjs';
import {JOURNAL_SPEC,JOURNAL_POLICY,journalEnabled,journalError,entryId,uuid,journalMutation,revisionContext,analysisContext,journalCursor} from './journal-policy.mjs';

export async function syncJournalAccess(db,patientId,consents){
 const enabled=consents.journalAiProcessing===true;
 await db.query(`INSERT INTO journal_access_guard(patient_id,health_data,processing,sharing,ai_enabled,policy_version)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(patient_id) DO UPDATE SET
 authorization_epoch=journal_access_guard.authorization_epoch+CASE WHEN
 (journal_access_guard.health_data,journal_access_guard.processing,journal_access_guard.ai_enabled,journal_access_guard.policy_version)
 IS DISTINCT FROM (EXCLUDED.health_data,EXCLUDED.processing,EXCLUDED.ai_enabled,EXCLUDED.policy_version) THEN 1 ELSE 0 END,
 health_data=EXCLUDED.health_data,processing=EXCLUDED.processing,sharing=EXCLUDED.sharing,ai_enabled=EXCLUDED.ai_enabled,policy_version=EXCLUDED.policy_version`,
 [patientId,consents.healthData===true,consents.journalProcessing===true,consents.journalSharing===true,enabled,enabled?JOURNAL_POLICY:null]);
 await db.query(`UPDATE journal_analysis_jobs j SET state='cancelled',lease_token=NULL,lease_until=NULL
 FROM journal_access_guard g WHERE j.patient_id=$1 AND g.patient_id=j.patient_id AND j.state IN('queued','running','retry_wait')
 AND (NOT(g.health_data AND g.processing AND g.ai_enabled) OR g.authorization_epoch<>j.authorization_epoch)`,[patientId]);
}
const decodeRevision=(row,key)=>({...unseal(row.payload,key,row.cipher_context),revision:row.revision});
const audit=(db,patient,actor,action,id=null,revision=null)=>db.query('INSERT INTO journal_audit_events(id,patient_id,actor_id,action,entry_id,revision) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),patient,actor,action,id,revision]);
export function createJournalStore({transaction,key}){
 const statusView=(row,revision)=>row?{status:row.state,revision,synthetic:true,...(row.payload?{result:unseal(row.payload,key,analysisContext(row.id))}:{}),...(row.error_code?{errorCode:row.error_code}:{})}:{status:'not_requested',revision,synthetic:true};
 const enqueue=async(db,patient,id,revision)=>{
  if(!journalEnabled())return;
  await db.query(`INSERT INTO journal_analysis_jobs(id,patient_id,entry_id,revision,spec_id,authorization_epoch)
  SELECT $1,g.patient_id,$3,$4,$5,g.authorization_epoch FROM journal_access_guard g
  WHERE g.patient_id=$2 AND g.health_data AND g.processing AND g.ai_enabled AND g.policy_version=$6
  ON CONFLICT(patient_id,entry_id,revision,spec_id,authorization_epoch) DO NOTHING`,[randomUUID(),patient,id,revision,JOURNAL_SPEC,JOURNAL_POLICY]);
 };
 const status=async(db,patient,id,revision)=>{
  const row=(await db.query(`SELECT j.id,j.state,j.error_code,a.payload FROM journal_analysis_jobs j
  LEFT JOIN journal_note_analyses a ON a.job_id=j.id WHERE j.patient_id=$1 AND j.entry_id=$2 AND j.revision=$3 ORDER BY j.created_at DESC,j.id DESC LIMIT 1`,[patient,id,revision])).rows[0];
  return statusView(row,revision);
 };
 const authorize=async(db,session,linkId)=>{
  if(session.account_role!=='doctor')throw journalError('Войдите в учётную запись врача',403);
  await db.query("SELECT set_config('app.actor_id',$1,true)",[session.patient_id]);
  let link=(await db.query('SELECT * FROM care_links WHERE id=$1',[linkId])).rows[0];
  if(!link||link.doctor_id!==session.patient_id)throw journalError('Подключение не найдено',404);
  // Concurrent readers may share this lock; consent revocation takes FOR UPDATE.
  await db.query('SELECT id FROM local_patients WHERE id=$1 FOR SHARE',[link.patient_id]);
  link=(await db.query('SELECT * FROM care_links WHERE id=$1 FOR SHARE',[linkId])).rows[0];
  if(!link||link.status!=='active')throw journalError('Доступ отозван',403);
  await db.query("SELECT set_config('app.patient_id',$1,true)",[link.patient_id]);
  const consent=await readPatientConsent(db,link.patient_id,key);
  if(!consent.healthData||!consent.journalProcessing||!consent.journalSharing)throw journalError('Пациент не разрешил доступ к заметкам',403);
  return link;
 };
 const detail=async(db,patient,id,revision)=>{
  if(!entryId(id))throw journalError('Запись не найдена',404);
  const head=(await db.query('SELECT current_revision FROM journal_notes WHERE patient_id=$1 AND entry_id=$2',[patient,id])).rows[0];
  if(!head)throw journalError('Запись не найдена',404);
  const number=revision===null?head.current_revision:Number(revision);
  if(!Number.isInteger(number)||number<1)throw journalError('Некорректная версия');
  const row=(await db.query('SELECT * FROM journal_note_revisions WHERE patient_id=$1 AND entry_id=$2 AND revision=$3',[patient,id,number])).rows[0];
  if(!row)throw journalError('Версия не найдена',404);
  return {entry:decodeRevision(row,key),currentRevision:head.current_revision,analysis:await status(db,patient,id,number)};
 };
 return {
  // Caller already holds the patient's write lock and has checked health consent.
  async save(db,patient,id,input,previous){
   const fingerprint=journalMutation(input,key);
   const receipt=(await db.query('SELECT * FROM journal_mutation_receipts WHERE patient_id=$1 AND mutation_id=$2',[patient,input.mutationId])).rows[0];
   if(receipt){if(receipt.entry_id!==id||receipt.fingerprint!==fingerprint)throw journalError('Идентификатор сохранения уже использован',409);
    const old=await detail(db,patient,id,receipt.saved_revision);return {...old.entry,currentRevision:old.currentRevision,analysis:old.analysis};}
   const head=(await db.query('SELECT current_revision FROM journal_notes WHERE patient_id=$1 AND entry_id=$2 FOR UPDATE',[patient,id])).rows[0],current=head?.current_revision||0;
   if(input.expectedRevision!==current)throw journalError('Запись изменена в другом окне. Перечитайте её; ваш текст остаётся в форме',409);
   const record=validateEntry(input,id,previous),same=previous&&['title','body','day'].every(field=>previous[field]===record[field]);
   const revision=same?current:current+1;
   if(!same){
    const context=revisionContext(patient,id,revision),entry={...record,revision};
    await db.query('INSERT INTO patient_entries(patient_id,id,type,observation_day,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(patient_id,id) DO UPDATE SET observation_day=EXCLUDED.observation_day,payload=EXCLUDED.payload,saved_at=now()',[patient,id,'journal',record.day,seal(entry,key,`${patient}:${id}`)]);
    await db.query('INSERT INTO journal_notes(patient_id,entry_id,current_revision) VALUES($1,$2,$3) ON CONFLICT(patient_id,entry_id) DO UPDATE SET current_revision=EXCLUDED.current_revision,updated_at=now()',[patient,id,revision]);
    await db.query('INSERT INTO journal_note_revisions(patient_id,entry_id,revision,payload,cipher_context,observation_day) VALUES($1,$2,$3,$4,$5,$6)',[patient,id,revision,seal(entry,key,context),context,record.day]);
    await enqueue(db,patient,id,revision);await audit(db,patient,patient,'save',id,revision);
   }
   await db.query('INSERT INTO journal_mutation_receipts(patient_id,mutation_id,entry_id,saved_revision,fingerprint) VALUES($1,$2,$3,$4,$5)',[patient,input.mutationId,id,revision,fingerprint]);
   const saved=await detail(db,patient,id,revision);return {...saved.entry,currentRevision:revision,analysis:saved.analysis};
  },
  async own(session,id){return transaction(session.patient_id,async db=>{
   const result=await detail(db,session.patient_id,id,null);return {revision:result.entry.revision,analysis:result.analysis};
  });},
  async retry(session,id){
   if(session.account_role!=='patient')throw journalError('Войдите в аккаунт пациента',403);
   return transaction(session.patient_id,async db=>{
    await db.query('SELECT id FROM local_patients WHERE id=$1 FOR UPDATE',[session.patient_id]);
    const consent=await readPatientConsent(db,session.patient_id,key);if(!consent.healthData||!consent.journalProcessing||!consent.journalAiProcessing)throw journalError('Обработка заметок не разрешена',403);
    if(!journalEnabled())throw journalError('Тестовая обработка выключена',503);
    const result=await detail(db,session.patient_id,id,null);
    await db.query(`UPDATE journal_analysis_jobs SET state='queued',attempts=0,available_at=now(),error_code=NULL WHERE patient_id=$1 AND entry_id=$2 AND revision=$3 AND state='failed' AND available_at<now()-interval '1 minute'`,[session.patient_id,id,result.entry.revision]);
    await enqueue(db,session.patient_id,id,result.entry.revision);await audit(db,session.patient_id,session.patient_id,'retry',id,result.entry.revision);
    return status(db,session.patient_id,id,result.entry.revision);
   });
  },
  async notes(session,linkId,{limit,before}){return transaction(null,async db=>{
   const link=await authorize(db,session,linkId),values=[link.patient_id,limit+1],filter=before?' AND (n.updated_at,n.entry_id)<($3::timestamptz,$4)':'';
   if(before)values.push(before.at,before.id);
   const rows=(await db.query(`SELECT n.*,r.payload,r.cipher_context,r.revision,j.job_id,j.state,j.error_code,j.analysis_payload
    FROM journal_notes n JOIN journal_note_revisions r ON (r.patient_id,r.entry_id,r.revision)=(n.patient_id,n.entry_id,n.current_revision)
    LEFT JOIN LATERAL (
     SELECT job.id AS job_id,job.state,job.error_code,a.payload AS analysis_payload
     FROM journal_analysis_jobs job LEFT JOIN journal_note_analyses a ON a.job_id=job.id
     WHERE job.patient_id=n.patient_id AND job.entry_id=n.entry_id AND job.revision=n.current_revision
     ORDER BY job.created_at DESC,job.id DESC LIMIT 1
    ) j ON true
    WHERE n.patient_id=$1 ${filter} ORDER BY n.updated_at DESC,n.entry_id DESC LIMIT $2`,values)).rows;
   const page=rows.slice(0,limit),items=[];
   for(const row of page){const note=decodeRevision(row,key);items.push({id:note.id,title:note.title,day:note.day,revision:row.revision,updatedAt:row.updated_at,analysis:statusView(row.job_id?{id:row.job_id,state:row.state,error_code:row.error_code,payload:row.analysis_payload}:null,row.revision)});}
   await audit(db,link.patient_id,session.patient_id,'list');return {items,nextBefore:rows.length>limit?journalCursor(page.at(-1)):null};
  });},
  async note(session,linkId,id,revision){return transaction(null,async db=>{
   const link=await authorize(db,session,linkId),result=await detail(db,link.patient_id,id,revision);await audit(db,link.patient_id,session.patient_id,'read',id,result.entry.revision);return {...result,patientName:unseal(link.payload,key,'care-link:'+link.id).patientName};
  });},
  async alerts(session,{limit,before}){
   if(session.account_role!=='doctor')throw journalError('Войдите в аккаунт врача',403);
   if(before&&!uuid(before.id))throw journalError('Некорректная страница уведомлений');
   return transaction(null,async db=>{
    await db.query("SELECT set_config('app.actor_id',$1,true)",[session.patient_id]);
    const values=[limit+1],filter=before?' AND (a.created_at,a.id)<($2::timestamptz,$3::uuid)':'';if(before)values.push(before.at,before.id);
    const rows=(await db.query(`SELECT a.id,a.care_link_id AS "linkId",a.state,a.kind,a.created_at,a.state_revision AS "stateRevision" FROM doctor_note_alerts a WHERE true ${filter} ORDER BY a.created_at DESC,a.id DESC LIMIT $1`,values)).rows;
    const unread=Number((await db.query("SELECT count(*) FROM doctor_note_alerts WHERE state<>'acknowledged'")).rows[0].count);
    return {items:rows.slice(0,limit).map(row=>({...row,synthetic:true})),unread,nextBefore:rows.length>limit?journalCursor(rows[limit-1]):null};
   });
  },
  async alert(session,id,action,input={}){
   if(session.account_role!=='doctor')throw journalError('Войдите в аккаунт врача',403);
   if(!uuid(id))throw journalError('Уведомление не найдено',404);
   return transaction(null,async db=>{
    await db.query("SELECT set_config('app.actor_id',$1,true)",[session.patient_id]);
    let row=(await db.query('SELECT * FROM doctor_note_alerts WHERE id=$1',[id])).rows[0];if(!row)throw journalError('Уведомление не найдено',404);
    const link=await authorize(db,session,row.care_link_id);
    row=(await db.query('SELECT * FROM doctor_note_alerts WHERE id=$1 FOR '+(action?'UPDATE':'SHARE'),[id])).rows[0];if(!row)throw journalError('Уведомление недоступно',403);
    if(action){
     const next=action==='acknowledge'?'acknowledged':'seen';
     if(row.state!=='acknowledged'&&row.state!==next){if(input.expectedStateRevision!==row.state_revision)throw journalError('Состояние уведомления изменилось. Обновите список',409);
      row=(await db.query(`UPDATE doctor_note_alerts SET state=$2,state_revision=state_revision+1,seen_at=coalesce(seen_at,now()),acknowledged_at=CASE WHEN $2='acknowledged' THEN now() ELSE acknowledged_at END WHERE id=$1 RETURNING *`,[id,next])).rows[0];}
    }
    const source=(await db.query('SELECT * FROM journal_note_analyses WHERE job_id=$1',[row.analysis_id])).rows[0];
    const result=await detail(db,link.patient_id,source.entry_id,source.revision);
    await audit(db,link.patient_id,session.patient_id,action||'alert_read',source.entry_id,source.revision);
    return {...result,patientName:unseal(link.payload,key,'care-link:'+link.id).patientName,alert:{id:row.id,state:row.state,stateRevision:row.state_revision,kind:row.kind},analysis:{status:'succeeded',revision:source.revision,synthetic:true,result:unseal(source.payload,key,analysisContext(source.job_id))}};
   });
  }
 };
}
