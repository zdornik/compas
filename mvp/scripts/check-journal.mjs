// Run only against a dedicated freshly migrated QA database, never browser profiles.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createStore} from '../server/store.mjs';
import {createApi} from '../server/api.mjs';
import {processJournalJob} from './run-journal-worker.mjs';
import {stubJournalAnalysis,JOURNAL_POLICY,analysisContext} from '../server/journal-policy.mjs';
import {seal,unseal} from '../server/crypto.mjs';
import {dayKey} from '../src/domain.js';

assert.match(process.env.DB_NAME||'',/^compass_journal_qa_[a-f0-9]+$/,'A dedicated journal QA database is required');
process.env.JOURNAL_ANALYSIS_ENABLED='1';
const key=Buffer.from((await readFile(process.env.DATA_KEY_FILE,'utf8')).trim(),'base64');
const connection={host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME};
const worker=new pg.Pool({...connection,user:'compass_journal_worker',password:(await readFile(process.env.JOURNAL_DB_PASSWORD_FILE,'utf8')).trim()});
const admin=new pg.Pool({...connection,user:'compass_admin',password:(await readFile(process.env.ADMIN_DB_PASSWORD_FILE,'utf8')).trim()});
const store=await createStore(),server=createServer();let origin;
const jars={patient:new Map(),doctor:new Map()},csrf={},account={};
async function request(role,path,{method='GET',body,expected}={}){
 const response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Compass-Client':'web','X-Compass-Role':role,...(csrf[role]?{'X-CSRF-Token':csrf[role]}:{}),Cookie:[...jars[role]].map(([k,v])=>k+'='+v).join('; ')},...(body===undefined?{}:{body:JSON.stringify(body)})});
 for(const cookie of response.headers.getSetCookie()){const [first]=cookie.split(';'),index=first.indexOf('=');jars[role].set(first.slice(0,index),first.slice(index+1));}
 const data=await response.json();if(expected!==undefined)assert.equal(response.status,expected,JSON.stringify(data));return {status:response.status,data};
}
const consent=async(ai=true,sharing=true)=>{
 const result=await request('patient','/api/auth/consents',{method:'POST',expected:200,body:{healthData:true,journalProcessing:true,journalSharing:sharing,journalAiProcessing:ai,...(ai?{providerPolicyVersion:JOURNAL_POLICY}:{}),expectedConsentUpdatedAt:account.patient.consentUpdatedAt}});account.patient=result.data.account;
};
const input=(id,body,revision=0)=>({id,type:'journal',title:'Синтетическая заметка',body,day:dayKey(),expectedRevision:revision,mutationId:randomUUID()});
const save=(entry,expected=200)=>request('patient','/api/entries/'+entry.id,{method:'PUT',body:entry,expected});
try{
 assert.equal(Number((await admin.query('SELECT count(*) FROM auth_accounts')).rows[0].count),0,'Use a fresh empty QA database for each run');
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 const api=await createApi({store,siteOrigin:origin});server.on('request',(req,res)=>api(req,res,new URL(req.url,origin).pathname));
 for(const role of ['patient','doctor']){
  const session=await request(role,'/api/session',{method:'POST',expected:201});csrf[role]=session.data.csrfToken;
  const result=await request(role,'/api/auth/register',{method:'POST',expected:201,body:{role,email:'journal-'+role+'-'+randomUUID()+'@example.invalid',password:'Synthetic-journal-password-2026',profile:{name:'Тест',surname:role,...(role==='patient'?{age:30}:{})},consents:{healthData:true}}});csrf[role]=result.data.csrfToken;account[role]=result.data.account;
 }
 const profile=(await request('patient','/api/care/profile',{method:'POST',body:{},expected:200})).data;
 const link=(await request('doctor','/api/care/claim',{method:'POST',body:{code:profile.code},expected:201})).data;
 await request('patient','/api/care/links/'+link.id,{method:'POST',body:{status:'active'},expected:200});
 const privateNote=input(randomUUID(),'Синтетическая приватная запись');assert.equal((await save(privateNote)).data.analysis.status,'not_requested');
 await request('doctor','/api/care/patients/'+link.id+'/notes',{expected:403});
 await consent();assert.equal(await processJournalJob(worker,key),false,'No retroactive analysis');
 const routine=input(randomUUID(),'Синтетическая обычная запись');await save(routine);await processJournalJob(worker,key);
 const notes=(await request('doctor','/api/care/patients/'+link.id+'/notes',{expected:200})).data;
 assert.ok(notes.items.every(note=>note.body===undefined));assert.equal(notes.items.find(note=>note.id===routine.id).analysis.result.synthetic,true);
 assert.equal((await request('doctor','/api/care/patients/'+link.id,{expected:200})).data.entries.some(e=>e.type==='journal'),false);
 const elevated=input(randomUUID(),'[TEST:elevated] Синтетический сигнал');await save(elevated);
 await Promise.all([processJournalJob(worker,key),processJournalJob(worker,key)]);
 let inbox=(await request('doctor','/api/care/alerts',{expected:200})).data;assert.equal(inbox.items.length,1);
 const alert=inbox.items[0],detail=(await request('doctor','/api/care/alerts/'+alert.id,{expected:200})).data;assert.equal(detail.entry.body,elevated.body);assert.equal(detail.analysis.result.signalLevel,'elevated');
 const seen=(await request('doctor','/api/care/alerts/'+alert.id+'/seen',{method:'POST',body:{expectedStateRevision:1},expected:200})).data;
 await request('doctor','/api/care/alerts/'+alert.id+'/acknowledge',{method:'POST',body:{expectedStateRevision:1},expected:409});
 await request('doctor','/api/care/alerts/'+alert.id+'/acknowledge',{method:'POST',body:{expectedStateRevision:seen.alert.stateRevision},expected:200});
 const second=input(elevated.id,'Синтетическая вторая редакция',1);await save(second);
 const retried=await save(elevated);assert.equal(retried.data.revision,1);assert.equal(retried.data.currentRevision,2);
 await save({...elevated,body:'changed'},409);await save(input(elevated.id,'stale',1),409);await save({...input(randomUUID(),'no revision'),expectedRevision:undefined},428);
 let release,started;const begin=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const pending=processJournalJob(worker,key,{analyze:async note=>{started();await gate;return stubJournalAnalysis(note);}});await begin;
 await save(input(elevated.id,'[TEST:urgent] Синтетическая третья редакция',2));await processJournalJob(worker,key);release();await pending;
 const latest=(await request('doctor','/api/care/patients/'+link.id+'/notes/'+elevated.id,{expected:200})).data;
 assert.equal(latest.entry.revision,3);assert.equal(latest.analysis.result.signalLevel,'urgent');
 assert.equal((await request('doctor','/api/care/alerts/'+alert.id,{expected:200})).data.entry.revision,1);
 await save(input(randomUUID(),'[TEST:urgent] Отзыв во время запроса'));
 await processJournalJob(worker,key,{analyze:async note=>{await consent(false);return stubJournalAnalysis(note);}});
 assert.equal(Number((await admin.query("SELECT count(*) FROM journal_analysis_jobs WHERE state='cancelled'")).rows[0].count),1);
 assert.equal(Number((await admin.query('SELECT count(*) FROM journal_note_analyses')).rows[0].count),4);
 await consent(true);assert.equal(await processJournalJob(worker,key),false,'Re-enabling cannot revive an old epoch');
 await consent(true,false);await request('doctor','/api/care/patients/'+link.id+'/notes',{expected:403});
 assert.equal((await request('doctor','/api/care/alerts',{expected:200})).data.items.length,0);
 await request('doctor','/api/care/alerts/'+alert.id,{expected:404});
 await request('patient','/api/state',{expected:200});
 await consent(true,true);
 const noOp=input(routine.id,routine.body,1);assert.equal((await save(noOp)).data.revision,1);
 await save(input(routine.id,'Изменено после пустого сохранения',1));
 const noOpRetry=await save(noOp);assert.equal(noOpRetry.data.revision,1);assert.equal(noOpRetry.data.currentRevision,2);
 await processJournalJob(worker,key);
 const race=await Promise.all([request('patient','/api/entries/'+routine.id,{method:'PUT',body:input(routine.id,'race a',2)}),request('patient','/api/entries/'+routine.id,{method:'PUT',body:input(routine.id,'race b',2)})]);
 assert.deepEqual(race.map(row=>row.status).sort(),[200,409]);await processJournalJob(worker,key);
 const leaseNote=input(randomUUID(),'Синтетическая проверка аренды');await save(leaseNote);
 const stale=randomUUID(),fresh=randomUUID(),claimed=(await worker.query('SELECT * FROM journal_claim($1)',[stale])).rows[0];
 await admin.query("UPDATE journal_analysis_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[claimed.id]);
 const reclaimed=(await worker.query('SELECT * FROM journal_claim($1)',[fresh])).rows[0];assert.equal(reclaimed.id,claimed.id);
 const source=(await worker.query('SELECT * FROM journal_load($1,$2)',[claimed.id,fresh])).rows[0],result=await stubJournalAnalysis(unseal(source.payload,key,source.cipher_context)),payload=seal(result,key,analysisContext(claimed.id));
 assert.equal((await worker.query('SELECT journal_complete($1,$2,$3,$4) ok',[claimed.id,stale,payload,'routine'])).rows[0].ok,false);
 assert.equal((await worker.query('SELECT journal_complete($1,$2,$3,$4) ok',[claimed.id,fresh,payload,'routine'])).rows[0].ok,true);
 const failing=input(randomUUID(),'Синтетическая ошибка обработки');await save(failing);
 for(let i=0;i<4;i++){await admin.query("UPDATE journal_analysis_jobs SET available_at=now() WHERE patient_id IS NOT NULL AND state='retry_wait'");await processJournalJob(worker,key,{analyze:async()=>{throw Error('Do not log this private provider response');}});}
 const failed=(await admin.query('SELECT * FROM journal_analysis_jobs WHERE entry_id=$1',[failing.id])).rows[0];assert.equal(failed.state,'failed');assert.equal(failed.attempts,4);assert.equal(failed.error_code,'STUB_ERROR');
 await admin.query("UPDATE journal_analysis_jobs SET available_at=now()-interval '2 minutes' WHERE id=$1",[failed.id]);
 await request('patient','/api/journal/'+failing.id+'/analysis/retry',{method:'POST',body:{},expected:200});
 await request('patient','/api/journal/'+failing.id+'/analysis/retry',{method:'POST',body:{},expected:200});
 assert.equal(Number((await admin.query('SELECT count(*) FROM journal_analysis_jobs WHERE entry_id=$1',[failing.id])).rows[0].count),1);await processJournalJob(worker,key);
 await assert.rejects(()=>worker.query('SELECT * FROM patient_entries'),error=>error.code==='42501');
 await assert.rejects(()=>worker.query('SELECT * FROM auth_accounts'),error=>error.code==='42501');
 await assert.rejects(()=>worker.query('SELECT * FROM journal_note_revisions'),error=>error.code==='42501');
 assert.equal((await worker.query('SELECT * FROM journal_load($1,$2)',[randomUUID(),randomUUID()])).rows.length,0);
 assert.equal(Number((await admin.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='knowledge' AND table_name LIKE 'journal%'")).rows[0].count),0);
 const raw=await admin.query('SELECT payload FROM journal_note_revisions');assert.ok(raw.rows.every(row=>!row.payload.includes(Buffer.from('Синтетическая'))));
 if(process.env.JOURNAL_QA_UI_FILE)await writeFile(process.env.JOURNAL_QA_UI_FILE,JSON.stringify({patient:account.patient.email,doctor:account.doctor.email,password:'Synthetic-journal-password-2026',linkId:link.id}),{mode:0o600});
 console.log(JSON.stringify({passed:true,syntheticOnly:true,database:process.env.DB_NAME,checks:'consent, encrypted versions, exact retries, stale revisions, queue concurrency, out-of-order results, alert acknowledgement, revocation in flight, hidden inbox, worker privileges, reference isolation'}));
}finally{await new Promise(resolve=>server.close(resolve));await Promise.all([store.close(),worker.end(),admin.end()]);}
