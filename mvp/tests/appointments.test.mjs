import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {appointmentInput,appointmentFuture,appointmentAction,appointmentPage,appointmentHash} from '../server/appointment-policy.mjs';
import {appointmentStart,appointmentStatus,appointmentDay,appointmentDays} from '../src/appointments.js';
import {createApi} from '../server/api.mjs';
import {createAppointmentStore} from '../server/appointment-store.mjs';

const valid=()=>({id:randomUUID(),linkId:randomUUID(),startsAt:'2026-10-21T06:00:00.000Z',durationMinutes:30,format:'online',note:' Тестовый приём '});
test('appointments validate bounded real timestamps, identity, duration and encrypted-text input',()=>{
 const input=valid();assert.equal(appointmentInput(input).note,'Тестовый приём');
 for(const patch of [{id:'wrong'},{linkId:'wrong'},{startsAt:'2026-02-30T06:00:00.000Z'},{startsAt:'2026-10-21T09:00:00+03:00'},{startsAt:'0000-10-21T06:00:00.000Z'},{durationMinutes:0},{durationMinutes:181},{durationMinutes:16},{format:'video'},{note:'x'.repeat(1001)},{note:'private\0text'}])assert.throws(()=>appointmentInput({...input,...patch}),{status:422});
 const key=randomBytes(32);assert.equal(appointmentHash(key,input),appointmentHash(key,{...input}));assert.notEqual(appointmentHash(key,input),appointmentHash(key,{...input,note:'other'}));
});
test('appointment times use Moscow explicitly and cannot be booked in the past or over a year ahead',()=>{
 assert.equal(appointmentStart('2026-10-21','09:00'),'2026-10-21T06:00:00.000Z');
 assert.equal(appointmentDay({startsAt:'2026-10-20T22:00:00.000Z'}),'2026-10-21');
 assert.deepEqual(appointmentDays({startsAt:'2026-10-20T20:45:00.000Z',endsAt:'2026-10-20T21:15:00.000Z'}),['2026-10-20','2026-10-21']);
 assert.deepEqual(appointmentDays({startsAt:'2026-10-20T20:45:00.000Z',endsAt:'2026-10-20T21:00:00.000Z'}),['2026-10-20']);
 const now=new Date('2026-10-20T12:00:00Z');assert.doesNotThrow(()=>appointmentFuture('2026-10-21T06:00:00.000Z',now));
 assert.throws(()=>appointmentFuture(now.toISOString(),now),{status:422});assert.throws(()=>appointmentFuture('2028-01-01T00:00:00Z',now),{status:422});
 assert.match(appointmentStatus({status:'confirmed',endsAt:'2026-10-19T00:00:00Z'},now.getTime()),/Время приёма прошло/);
});
test('appointment pages bound calendar range, pagination and status with Moscow midnight',()=>{
 const page=appointmentPage(new URLSearchParams({from:'2026-10-21',to:'2026-10-21',limit:'20'}));assert.equal(page.from,'2026-10-20T21:00:00.000Z');assert.equal(page.to,'2026-10-21T21:00:00.000Z');
 for(const params of [{from:'2026-02-30'},{from:'2026-10-21',to:'2026-10-20'},{from:'2026-01-01',to:'2028-01-01'},{limit:'0'},{limit:'201'},{status:'deleted'},{after:'bad'}])assert.throws(()=>appointmentPage(new URLSearchParams(params)),{status:422});
});
test('appointment changes require explicit action identity and a current optimistic revision',()=>{
 const input={mutationId:randomUUID(),expectedRevision:1};assert.equal(appointmentAction(input,'confirm').action,'confirm');
 for(const [value,action] of [[{},'confirm'],[input,'reschedule'],[{...input,expectedRevision:0},'cancel'],[{...input,expectedRevision:1.5},'decline']])assert.throws(()=>appointmentAction(value,action),{status:422});
});
test('appointment storage rejects anonymous and invalid-role sessions before touching the database',async()=>{
 const store=createAppointmentStore({key:randomBytes(32),transaction:async()=>{throw Error('Unexpected database access');}});
 for(const session of [null,{patient_id:randomUUID()},{account_id:randomUUID(),account_role:'admin'}]){
  await assert.rejects(()=>store.list(session,{}),{status:401});await assert.rejects(()=>store.create(session,valid()),{status:401});await assert.rejects(()=>store.change(session,randomUUID(),'cancel',{}),{status:401});
 }
});
test('appointment writes keep Origin/CSRF and account-change protection',async()=>{
 const origin='http://127.0.0.1:4174',token='a'.repeat(64),calls=[];
 const session={patient_id:randomUUID(),account_id:randomUUID(),account_role:'patient',csrf_token:'csrf'},store={session:async()=>session,auth:{requireHealthConsent:async()=>{}},appointments:{create:async(_s,input)=>{calls.push(input);return {status:'requested'};}}};
 const api=await createApi({store,siteOrigin:origin});
 const post=async({csrf='csrf',source=origin,hint=session.account_id}={})=>{
  const req=Readable.from([Buffer.from(JSON.stringify(valid()))]);req.url='/api/appointments';req.method='POST';req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'127.0.0.1:4174',origin:source,'content-type':'application/json','x-compass-client':'web','x-compass-role':'patient','x-csrf-token':csrf,'x-compass-account':hint,cookie:'compass_session='+token};
  const result={};await api(req,{setHeader(){},writeHead(status){result.status=status;},end(body){result.data=JSON.parse(body);}},'/api/appointments');return result;
 };
 assert.equal((await post({csrf:'bad'})).status,403);assert.equal((await post({source:'https://other.invalid'})).status,403);assert.equal((await post({hint:'other-account'})).status,409);assert.equal(calls.length,0);assert.equal((await post()).status,201);assert.equal(calls.length,1);
});
test('appointments have database-enforced interval conflicts, RLS and immutable encrypted events outside knowledge',async()=>{
 const sql=await readFile(new URL('../docker/migrations/018-appointments.sql',import.meta.url),'utf8');
 assert.equal((sql.match(/EXCLUDE USING gist/g)||[]).length,2);assert.match(sql,/tstzrange\(starts_at,ends_at,'\[\)'\)/);assert.match(sql,/WHERE\(status='confirmed'\)/);assert.match(sql,/FORCE ROW LEVEL SECURITY/);assert.match(sql,/payload bytea NOT NULL/);assert.match(sql,/UNIQUE\(appointment_id,mutation_id\)/);assert.doesNotMatch(sql,/GRANT.*(?:DELETE|UPDATE).*care_appointment_events/);assert.doesNotMatch(sql,/CREATE TABLE knowledge\./);
});
