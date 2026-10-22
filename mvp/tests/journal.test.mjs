import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {journalMutation,stubJournalAnalysis,validateJournalAnalysis,journalPage,JOURNAL_POLICY} from '../server/journal-policy.mjs';
import {validateConsents,consentUpdate} from '../server/auth-policy.mjs';
import {processJournalJob} from '../scripts/run-journal-worker.mjs';

test('journal saves require an optimistic revision and a stable idempotency identity',()=>{
 const key=randomBytes(32),input={id:'note',type:'journal',title:' title ',body:' body ',day:'2026-10-20',expectedRevision:0,mutationId:randomUUID()};
 assert.equal(journalMutation(input,key),journalMutation({...input,title:'title',body:'body'},key));
 assert.notEqual(journalMutation(input,key),journalMutation({...input,body:'different'},key));
 assert.throws(()=>journalMutation({...input,expectedRevision:undefined},key),{status:428});
 assert.throws(()=>journalMutation({...input,mutationId:'bad'},key));
 for(const invalid of [{title:42},{body:{}},{body:''}])assert.throws(()=>journalMutation({...input,...invalid},key),{status:422});
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
