import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {careMessageInput,careMessagePage,createCareChatStore} from '../server/chat-store.mjs';
import {seal,unseal} from '../server/crypto.mjs';
const patientId='11111111-1111-4111-8111-111111111111',doctorId='22222222-2222-4222-8222-222222222222',linkId='33333333-3333-4333-8333-333333333333';
const messageId='44444444-4444-4444-8444-444444444444';
const patient={patient_id:patientId},doctor={patient_id:doctorId,doctor_enabled:true};
function fixture({status='active',consent=null}={}) {
 const key=randomBytes(32),messages=[],queries=[];let currentStatus=status;
 const link={id:linkId,patient_id:patientId,doctor_id:doctorId,get status(){return currentStatus;}};
 const db={async query(sql,params=[]){queries.push({sql,params});
  if(sql.startsWith('SELECT set_config'))return {rows:[]};
  if(sql==='SELECT id FROM local_patients WHERE id=$1 FOR UPDATE')return {rows:[{id:patientId}]};
  if(sql.startsWith('SELECT * FROM care_links WHERE id=$1'))return {rows:params[0]===linkId?[link]:[]};
  if(sql==='SELECT id,payload FROM auth_accounts WHERE principal_id=$1 FOR SHARE')return {rows:consent?[{id:'account',payload:seal({consents:consent},key,'auth-account:account')}]:[]};
  if(sql.startsWith('SELECT id,sender_id,payload'))return {rows:messages.filter(row=>row.id===params[1])};
  if(sql.startsWith('INSERT INTO care_messages')){const row={link_id:params[0],id:params[1],sender_id:params[2],payload:params[3],created_at:new Date('2026-10-19T11:00:00.000Z')};messages.push(row);return {rows:[row]};}
  if(sql.startsWith('SELECT id,payload,created_at FROM care_messages')){let rows=[...messages].sort((a,b)=>b.created_at-a.created_at||b.id.localeCompare(a.id));if(params.length===4)rows=rows.filter(row=>row.created_at.toISOString()<params[1]||row.created_at.toISOString()===params[1]&&row.id<params[2]);return {rows:rows.slice(0,params.at(-1))};}
  throw new Error('Unexpected SQL');
 }};
 return {key,messages,queries,store:createCareChatStore({key,transaction:async(_,callback)=>callback(db)}),revoke:()=>{currentStatus='revoked';}};
}
test('chat rejects invalid IDs, empty/control-character bodies and unbounded pagination',()=>{
 assert.deepEqual(careMessageInput({id:messageId.toUpperCase(),body:'  текст\r\nпродолжение  ',senderRole:'doctor'}),{id:messageId,body:'текст\nпродолжение'});
 for(const body of ['', '   ', 'x'.repeat(6001), 'test\0text'])assert.throws(()=>careMessageInput({id:messageId,body}),{status:422});
 assert.throws(()=>careMessageInput({id:'wrong',body:'text'}),{status:422});
 assert.equal(careMessagePage().limit,40);
 for(const input of [{limit:0},{limit:101},{limit:2.5},{before:'invalid'},{before:'../'},{before:Buffer.from(JSON.stringify({id:messageId,at:'0000-01-01T00:00:00.000Z'})).toString('base64url')}])assert.throws(()=>careMessagePage(input),{status:422});
});
test('chat stores ciphertext, derives sender from link and handles exact retries without duplicate messages',async()=>{
 const f=fixture(),body='Синтетическое сообщение для проверки';
 const saved=await f.store.send(patient,linkId,{id:messageId,body,senderRole:'doctor'});
 assert.equal(saved.senderRole,'patient');assert.equal(saved.body,body);assert.equal(f.messages.length,1);assert.ok(Buffer.isBuffer(f.messages[0].payload));assert.equal(f.messages[0].payload.includes(Buffer.from(body)),false);
 assert.equal(unseal(f.messages[0].payload,f.key,'care-message:'+linkId+':'+messageId).body,body);
 assert.throws(()=>unseal(f.messages[0].payload,f.key,'care-message:another:'+messageId));
 assert.deepEqual(await f.store.send(patient,linkId,{id:messageId,body}),saved);assert.equal(f.messages.length,1);
 await assert.rejects(()=>f.store.send(patient,linkId,{id:messageId,body:'Иной текст'}),{status:409});
 await assert.rejects(()=>f.store.send(doctor,linkId,{id:messageId,body}),{status:409});
 assert.equal((await f.store.messages(doctor,linkId)).messages[0].senderRole,'patient');
});
test('every chat read/send checks ownership, active link and clinician identity',async()=>{
 const f=fixture();await f.store.send(patient,linkId,{id:messageId,body:'Тест'});
 await assert.rejects(()=>f.store.messages({patient_id:'other'},linkId),{status:404});
 await assert.rejects(()=>f.store.messages({patient_id:doctorId,doctor_enabled:false},linkId),{status:403});
 f.revoke();await assert.rejects(()=>f.store.messages(patient,linkId),{status:403});
 await assert.rejects(()=>f.store.messages(doctor,linkId),{status:403});
 await assert.rejects(()=>f.store.send(patient,linkId,{id:messageId,body:'Тест'}),{status:403});
 assert.equal(f.messages.length,1);
});
test('revoked health-data consent prevents doctor reads and every new message',async()=>{
 const f=fixture({consent:{healthData:false,journalSharing:false,journalProcessing:false}});
 await assert.rejects(()=>f.store.messages(doctor,linkId),{status:403});
 await assert.rejects(()=>f.store.send(patient,linkId,{id:messageId,body:'Тест'}),{status:403});
 await assert.rejects(()=>f.store.send(doctor,linkId,{id:messageId,body:'Тест'}),{status:403});
 assert.equal(f.messages.length,0);
 assert.ok(f.queries.some(query=>query.sql==='SELECT id,payload FROM auth_accounts WHERE principal_id=$1 FOR SHARE'));
});
test('cursor pagination preserves equal timestamp ordering and bounds returned history',async()=>{
 const f=fixture();for(let i=1;i<=5;i++)await f.store.send(i%2?patient:doctor,linkId,{id:`44444444-4444-4444-8444-${String(i).padStart(12,'0')}`,body:'Синтетическое '+i});
 const first=await f.store.messages(patient,linkId,{limit:2});assert.equal(first.messages.length,2);assert.equal(first.hasMore,true);assert.deepEqual(first.messages.map(row=>row.body),['Синтетическое 4','Синтетическое 5']);
 const second=await f.store.messages(patient,linkId,{limit:2,before:first.nextBefore});assert.deepEqual(second.messages.map(row=>row.body),['Синтетическое 2','Синтетическое 3']);
 const last=await f.store.messages(patient,linkId,{limit:2,before:second.nextBefore});assert.deepEqual(last.messages.map(row=>row.body),['Синтетическое 1']);assert.equal(last.hasMore,false);assert.equal(last.nextBefore,null);
});
