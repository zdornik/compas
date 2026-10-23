// Backup the owned synthetic presentation instance; restore into a NEW QA database only.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import pg from 'pg';
import {adminClient,dropIsolatedDatabase,root} from './database-tools.mjs';
import {createPrivateBackup,restorePrivateBackup} from './private-backup.mjs';
import {createStore} from '../server/store.mjs';
import {processJournalJob} from './run-journal-worker.mjs';
import {dayKey} from '../src/domain.js';
import {historyOptions} from '../server/history.mjs';
import {verifyBlob} from '../server/reference-files.mjs';

const base=join(root,'qa/presentation'),instance=JSON.parse(await readFile(join(base,'instance.json'),'utf8'));
assert.equal(instance.version,1);assert.match(instance.id,/^[a-f0-9]{12}$/);assert.equal(instance.database,'compass_presentation_'+instance.id);assert.equal(instance.pgPort,55434);
const secrets=join(base,'secrets'),secret=name=>readFile(join(secrets,name),'utf8').then(value=>value.trim());
const config={host:'127.0.0.1',port:55434,user:'compass_admin',adminPassword:await secret('admin_db_password'),appPassword:await secret('app_db_password'),workerPassword:await secret('journal_db_password')};
const source=await adminClient(config,instance.database);
try{assert.equal(resolve((await source.query('SHOW data_directory')).rows[0].data_directory),join(base,'postgres'));}finally{await source.end();}
const keyFile=join(secrets,'backup_key'),action=process.argv[2]||'create',reportDirectory=join(root,'qa/backup');
await mkdir(reportDirectory,{recursive:true,mode:0o700});
if(action==='create'){
  try{await access(keyFile);}catch{await writeFile(keyFile,randomBytes(32).toString('base64'),{flag:'wx',mode:0o600});}
  const path=join(root,'backups/presentation',new Date().toISOString().replaceAll(':','-')+'-'+randomBytes(3).toString('hex')+'.cpbak');
  const result=await createPrivateBackup({config,database:instance.database,dataKeyFile:join(secrets,'data_key'),archive:join(base,'reference/blobs'),backupKeyFile:keyFile,path});
  await writeFile(join(base,'last-backup.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}else if(action==='check'){
  const path=process.argv[3]||JSON.parse(await readFile(join(base,'last-backup.json'),'utf8')).path;
  const database='compass_journal_qa_'+randomBytes(6).toString('hex'),directory=join(root,'qa/backup/restore-'+randomBytes(6).toString('hex'));
  const started=performance.now();let restored,store,worker;
  try{
    restored=await restorePrivateBackup({config,path,backupKeyFile:keyFile,database,directory});
    const db=await adminClient(config,database);
    try{
      assert.equal(Number((await db.query('SELECT count(*) FROM app_sessions')).rows[0].count),0,'Old sessions must not be recovered');
      for(const object of (await db.query('SELECT blob_key,original_bytes FROM knowledge.documents WHERE blob_key IS NOT NULL UNION SELECT blob_key,original_bytes FROM knowledge.page_assets WHERE blob_key IS NOT NULL')).rows)await verifyBlob(restored.archive,object.blob_key,Number(object.original_bytes));
      assert.equal((await db.query("SELECT count(*) FROM journal_analysis_jobs WHERE state='running'")).rows[0].count,'0');
    }finally{await db.end();}
    Object.assign(process.env,{DB_HOST:config.host,DB_PORT:String(config.port),DB_NAME:database,DB_PASSWORD_FILE:join(secrets,'app_db_password'),DATA_KEY_FILE:restored.dataKeyFile,REFERENCE_FILES_DIR:restored.archive,JOURNAL_ANALYSIS_ENABLED:'1',JOURNAL_PROVIDER:'stub'});
    store=await createStore();const credentials=JSON.parse(await readFile(join(base,'accounts.json'),'utf8')),sessions={};
    for(const role of ['patient','doctor'])sessions[role]=await store.session((await store.auth.login({role,email:credentials[role],password:credentials.password})).token);
    const patient=sessions.patient,doctor=sessions.doctor;
    const notes=await store.history(patient.patient_id,historyOptions(new URLSearchParams({kind:'notes',limit:100})));
    assert.ok(notes.entries.length>=2);
    const original=await store.entry(patient.patient_id,notes.entries[0].id);assert.ok(original.body.length>0);
    const links=await store.care.links(doctor);assert.ok(links.doctorLinks.some(link=>link.id===credentials.linkId&&link.status==='active'));
    await store.journal.notes(doctor,credentials.linkId,{limit:20,before:null});
    const isolated=await store.createSession(),outsider=await store.session(isolated.token);
    await assert.rejects(()=>store.entry(outsider.patient_id,original.id),{status:404});
    await assert.rejects(()=>store.care.patient(outsider,credentials.linkId),{status:404});
    // New writes and a fresh worker lease must operate using the recovered key/schema.
    const id=randomUUID();await store.saveEntry(patient.patient_id,id,{id,type:'journal',title:'Проверка восстановления',body:'[TEST:elevated] Синтетическая запись в восстановленной копии.',day:dayKey(),expectedRevision:0,mutationId:randomUUID()});
    worker=new pg.Pool({host:config.host,port:config.port,database,user:'compass_journal_worker',password:config.workerPassword});
    const key=Buffer.from((await readFile(restored.dataKeyFile,'utf8')).trim(),'base64');
    for(let i=0;i<100;i++){if((await store.journal.own(patient,id)).analysis.status==='succeeded')break;if(!await processJournalJob(worker,key))break;}
    assert.equal((await store.journal.own(patient,id)).analysis.status,'succeeded');
    assert.ok((await store.journal.alerts(doctor,{limit:20,before:null})).items.length>0);
    await assert.rejects(()=>worker.query('SELECT payload FROM public.patient_entries'),{code:'42501'});
    const report={passed:true,syntheticOnly:true,restoreMs:Math.round(performance.now()-started),tables:restored.tables,objects:restored.objects,checks:['fresh database','all table counts and migrations','RLS and security-definer owners/ACLs','no restored sessions','reference object hashes','password login in both roles','decrypted original','active approved link','unrelated patient denied','new write with recovered key','worker job and alert','worker direct reads denied'],bundle:resolve(path),remaining:'An off-device copy of the bundle and its separate backup key is still required for host loss.'};
    await writeFile(join(reportDirectory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
  }finally{
    await worker?.end();await store?.close();
    if(restored)await dropIsolatedDatabase(config,database);await rm(directory,{recursive:true,force:true});
  }
}else throw Error('Use create or check [backup.cpbak]');
