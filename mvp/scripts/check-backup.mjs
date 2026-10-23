import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {databaseConfig,adminClient,dropIsolatedDatabase} from './database-tools.mjs';
import {createPrivateBackup,restorePrivateBackup} from './private-backup.mjs';
import {createStore} from '../server/store.mjs';
import {seedSyntheticHistory} from './synthetic-history.mjs';
import {processJournalJob} from './run-journal-worker.mjs';
import {JOURNAL_POLICY} from '../server/journal-policy.mjs';
import {dayKey} from '../src/domain.js';
import {appointmentDayAfter,appointmentStart} from '../src/appointments.js';
import {appointmentPage} from '../server/appointment-policy.mjs';
assert.match(process.env.DB_NAME||'',/^compass_journal_qa_[a-f0-9]+$/);
const sourceName=process.env.DB_NAME,sourceKey=process.env.DATA_KEY_FILE,config=await databaseConfig();
const source=await createStore(),directory=await mkdtemp(join(tmpdir(),'compass-backup-integration-'));
const targetName='compass_journal_qa_'+randomBytes(6).toString('hex'),keyFile=join(directory,'backup_key'),path=join(directory,'backup.cpbak');
let target,restored,sourceWorker,targetWorker;
try{
  const fixture=await seedSyntheticHistory(source,{notes:3,days:14,plans:2}),{patient,doctor}=fixture.accounts;
  await source.auth.consents(patient.session,{healthData:true,journalProcessing:true,journalSharing:true,journalAiProcessing:true,providerPolicyVersion:JOURNAL_POLICY,expectedConsentUpdatedAt:patient.account.consentUpdatedAt});
  const noteId=randomUUID(),save=body=>source.saveEntry(patient.session.patient_id,noteId,{id:noteId,type:'journal',title:'Проверка backup',body,day:dayKey(),expectedRevision:body==='Первая редакция'?0:1,mutationId:randomUUID()});
  await save('Первая редакция');await save('[TEST:elevated] Вторая редакция');
  const connection={host:config.host,port:config.port,user:'compass_journal_worker',password:config.workerPassword};
  sourceWorker=new pg.Pool({...connection,database:sourceName});const sourceCipherKey=Buffer.from((await readFile(sourceKey,'utf8')).trim(),'base64');
  while(await processJournalJob(sourceWorker,sourceCipherKey)){}
  const pendingId=randomUUID();await source.saveEntry(patient.session.patient_id,pendingId,{id:pendingId,type:'journal',title:'Задание в обработке',body:'[TEST:elevated] Незавершённая синтетическая обработка.',day:dayKey(),expectedRevision:0,mutationId:randomUUID()});
  const oldLease=randomUUID(),claimed=(await sourceWorker.query('SELECT * FROM journal_claim($1)',[oldLease])).rows[0];assert.equal(claimed.entry_id,pendingId);
  const exhaustedId=randomUUID();await source.saveEntry(patient.session.patient_id,exhaustedId,{id:exhaustedId,type:'journal',title:'Последняя попытка',body:'Синтетический исчерпанный лимит попыток.',day:dayKey(),expectedRevision:0,mutationId:randomUUID()});
  const admin=await adminClient(config,sourceName);
  try{await admin.query("UPDATE journal_analysis_jobs SET state='running',attempts=4,lease_token=$1,lease_until=now()+interval '2 minutes' WHERE entry_id=$2",[randomUUID(),exhaustedId]);}finally{await admin.end();}
  const message=await source.chat.send(patient.session,fixture.linkId,{id:randomUUID(),body:'Синтетическое сообщение для восстановления'});
  const day=appointmentDayAfter(dayKey(),5),appointment={id:randomUUID(),linkId:fixture.linkId,startsAt:appointmentStart(day,'09:00'),durationMinutes:30,format:'online',note:'Синтетическая тема приёма'};
  await source.appointments.create(patient.session,appointment);await source.appointments.change(doctor.session,appointment.id,'confirm',{expectedRevision:1,mutationId:randomUUID()});
  await writeFile(keyFile,randomBytes(32).toString('base64'),{mode:0o600});
  await createPrivateBackup({config,database:sourceName,dataKeyFile:sourceKey,archive:join(directory,'empty-archive'),backupKeyFile:keyFile,path});
  assert.ok((await stat(path)).size>1000);
  // Neither an existing database nor an unauthenticated bundle can become a restore target.
  await assert.rejects(()=>restorePrivateBackup({config,path,backupKeyFile:keyFile,database:sourceName,directory:join(directory,'existing')}),/existing database/);
  const wrong=join(directory,'wrong-key');await writeFile(wrong,randomBytes(32).toString('base64'));
  await assert.rejects(()=>restorePrivateBackup({config,path,backupKeyFile:wrong,database:targetName,directory:join(directory,'bad')}));
  const check=await adminClient(config);try{assert.equal((await check.query('SELECT 1 FROM pg_database WHERE datname=$1',[targetName])).rows.length,0);}finally{await check.end();}
  restored=await restorePrivateBackup({config,path,backupKeyFile:keyFile,database:targetName,directory:join(directory,'restored')});
  process.env.DB_NAME=targetName;process.env.DATA_KEY_FILE=restored.dataKeyFile;target=await createStore();
  assert.equal(await target.session(patient.token),null,'Backed-up session tokens must be unusable');
  const patientLogin=await target.auth.login({role:'patient',email:patient.email,password:patient.password}),doctorLogin=await target.auth.login({role:'doctor',email:doctor.email,password:doctor.password});
  const p=await target.session(patientLogin.token),d=await target.session(doctorLogin.token);
  assert.equal((await target.entry(p.patient_id,noteId)).body,'[TEST:elevated] Вторая редакция');
  assert.equal((await target.journal.note(d,fixture.linkId,noteId,1)).entry.body,'Первая редакция');
  assert.equal((await target.chat.messages(d,fixture.linkId)).messages.find(row=>row.id===message.id).body,message.body);
  assert.equal((await target.appointments.list(p,appointmentPage(new URLSearchParams({from:day,to:day})))).items.find(row=>row.id===appointment.id).status,'confirmed');
  targetWorker=new pg.Pool({...connection,database:targetName});
  assert.equal((await targetWorker.query('SELECT * FROM journal_load($1,$2)',[claimed.id,oldLease])).rows.length,0,'Lost worker token must be fenced');
  assert.equal((await target.journal.own(p,exhaustedId)).analysis.status,'failed','A recovered fourth attempt must not be stuck in retry_wait');
  assert.equal(await processJournalJob(targetWorker,sourceCipherKey),true);assert.equal((await target.journal.own(p,pendingId)).analysis.status,'succeeded');
  const a=await adminClient(config,targetName);try{assert.equal((await a.query('SELECT attempts FROM journal_analysis_jobs WHERE id=$1',[claimed.id])).rows[0].attempts,2);}finally{await a.end();}
  await assert.rejects(()=>targetWorker.query('SELECT payload FROM patient_entries'),{code:'42501'});
  console.log('Private backup integration passed: encrypted database, old sessions rejected, preserved note versions/chat/appointments, owner and RLS parity, lost-lease fencing/recovery, exhausted attempts, wrong-key rejection and existing-target refusal.');
}finally{
  process.env.DB_NAME=sourceName;process.env.DATA_KEY_FILE=sourceKey;
  await Promise.all([source.close(),target?.close(),sourceWorker?.end(),targetWorker?.end()]);
  if(restored)await dropIsolatedDatabase(config,targetName);await rm(directory,{recursive:true,force:true});
}
