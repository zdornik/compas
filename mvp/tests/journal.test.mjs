import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {journalMutation,stubJournalAnalysis,validateJournalAnalysis,journalPage,JOURNAL_POLICY} from '../server/journal-policy.mjs';
import {validateConsents,consentUpdate} from '../server/auth-policy.mjs';
import {processJournalJob} from '../scripts/run-journal-worker.mjs';
import {createJournalStore} from '../server/journal-store.mjs';
import {seal} from '../server/crypto.mjs';

test('journal saves require an optimistic revision and a stable idempotency identity',()=>{
 const key=randomBytes(32),input={id:'note',type:'journal',title:' title ',body:' body ',day:'2026-10-20',expectedRevision:0,mutationId:randomUUID()};
 assert.equal(journalMutation(input,key),journalMutation({...input,title:'title',body:'body'},key));
 assert.notEqual(journalMutation(input,key),journalMutation({...input,body:'different'},key));
 assert.throws(()=>journalMutation({...input,expectedRevision:undefined},key),{status:428});
 assert.throws(()=>journalMutation({...input,mutationId:'bad'},key));
 for(const invalid of [{title:42},{body:{}},{body:''}])assert.throws(()=>journalMutation({...input,...invalid},key),{status:422});
});
test('note listing has a constant number of database round trips and preserves result ownership',async()=>{
 const key=randomBytes(32),patient=randomUUID(),doctor=randomUUID(),linkId=randomUUID(),accountId=randomUUID();let count=1,calls=0;
 const link={id:linkId,patient_id:patient,doctor_id:doctor,status:'active'};
 const rows=()=>Array.from({length:count},(_,i)=>{
  const id='note-'+i,job=randomUUID(),context='version:'+id;
  return {entry_id:id,revision:2,updated_at:'2026-10-23T12:00:00Z',payload:seal({id,title:id,day:'2026-10-23',body:'private'},key,context),cipher_context:context,
   ...(i%2?{}:{job_id:job,state:'succeeded',analysis_payload:seal({synthetic:true,summary:'summary '+id},key,'journal-analysis:'+job)})};
 });
 const db={async query(sql){calls++;
  if(sql.includes('FROM care_links'))return {rows:[link]};
  if(sql.includes('FROM auth_accounts'))return {rows:[{id:accountId,payload:seal({consents:{healthData:true,journalProcessing:true,journalSharing:true}},key,'auth-account:'+accountId)}]};
  if(sql.includes('FROM journal_notes n'))return {rows:rows()};
  if(sql.includes('FROM journal_analysis_jobs'))assert.fail('A separate analysis query per note must not be reintroduced');
  return {rows:[]};
 }};
 const store=createJournalStore({transaction:async(_,fn)=>fn(db),key}),session={account_role:'doctor',patient_id:doctor};
 await store.notes(session,linkId,{limit:50});const one=calls;calls=0;count=50;
 const result=await store.notes(session,linkId,{limit:50});assert.equal(calls,one);assert.equal(result.items.length,50);
 assert.equal(result.items[0].analysis.result.summary,'summary note-0');assert.equal(result.items[1].analysis.status,'not_requested');
 assert.ok(result.items.every(row=>row.body===undefined));
});
test('stub never classifies real text; only explicit synthetic markers select alert fixtures',async()=>{
 const ordinary=await stubJournalAnalysis({title:'test',body:'Я тревожусь и мне плохо'});assert.equal(ordinary.signalLevel,'routine');assert.equal(ordinary.synthetic,true);assert.match(ordinary.summary,/не оценка/);
 const body='Синтетический [TEST:elevated] пример',result=await stubJournalAnalysis({title:'test',body});assert.equal(result.signalLevel,'elevated');assert.equal(result.signals[0].sourceSpan.quote,'[TEST:elevated]');
 assert.throws(()=>validateJournalAnalysis({...result,signals:[{...result.signals[0],sourceSpan:{...result.signals[0].sourceSpan,quote:'invented'}}]},{title:'test',body}));
 assert.throws(()=>validateJournalAnalysis({...result,synthetic:false},{title:'test',body}));
});
test('AI opt-in is independent, versioned, and revoked by an old client rather than silently retained',()=>{
 const base={healthData:true,journalProcessing:true,journalSharing:true};
 assert.equal(validateConsents(base).journalAiProcessing,false);
 assert.throws(()=>validateConsents({...base,journalAiProcessing:true}));
 assert.throws(()=>validateConsents({...base,journalProcessing:false,journalSharing:false,journalAiProcessing:true,providerPolicyVersion:JOURNAL_POLICY}));
 const consent=validateConsents({...base,journalAiProcessing:true,providerPolicyVersion:JOURNAL_POLICY});assert.equal(consent.journalAiProcessing,true);
 const previous={consents:consent,consentUpdatedAt:'2026-10-20T00:00:00.000Z'};
 assert.equal(consentUpdate(previous,{...base,expectedConsentUpdatedAt:previous.consentUpdatedAt}).consents.journalAiProcessing,false);
 assert.throws(()=>consentUpdate(previous,{...base,expectedConsentUpdatedAt:'stale'}),{status:409});
});
test('note pagination is bounded and rejects malformed cursors',()=>{
 assert.equal(journalPage(new URLSearchParams()).limit,20);
 for(const q of ['limit=0','limit=51','before=../','before=bad'])assert.throws(()=>journalPage(new URLSearchParams(q)));
});
test('worker consumes only a claimed capability, never arbitrary patient IDs or reference data',async()=>{
 const calls=[],pool={async query(sql,args){calls.push({sql,args});return {rows:[]};}};
 assert.equal(await processJournalJob(pool,randomBytes(32)),false);assert.equal(calls.length,1);assert.match(calls[0].sql,/journal_claim/);
});
test('journal database and runtime wiring keep patient analyses out of reference releases',async()=>{
 const sql=await readFile(new URL('../docker/migrations/017-journal.sql',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/CREATE TABLE knowledge\./);assert.match(sql,/FOR UPDATE SKIP LOCKED/);assert.match(sql,/lease_token IS DISTINCT FROM p_token/);
 assert.match(sql,/REVOKE ALL ON FUNCTION/);assert.match(sql,/FORCE ROW LEVEL SECURITY/);assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/);
 const start=await readFile(new URL('../scripts/start-local.mjs',import.meta.url),'utf8');assert.match(start,/--skip-reference/);assert.match(start,/'web','journal-worker'/);
 const worker=await readFile(new URL('../scripts/run-journal-worker.mjs',import.meta.url),'utf8');assert.doesNotMatch(worker,/fetch\(|https?:\/\//);
});
