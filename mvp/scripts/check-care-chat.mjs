import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const origin=process.env.CHECK_ORIGIN||'http://127.0.0.1:4174';
async function actor(role){const response=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'X-Compass-Client':'web','X-Compass-Role':role}});assert.equal(response.status,201);return {role,cookie:response.headers.get('set-cookie').split(';')[0],csrf:(await response.json()).csrfToken};}
async function call(who,path,input,csrf=true){const response=await fetch(origin+path,{method:input?'POST':'GET',headers:{Origin:origin,Cookie:who.cookie,'X-Compass-Role':who.role,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':who.csrf}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:response.status,data:await response.json()};}
const patient=await actor('patient'),doctor=await actor('doctor'),outsider=await actor('patient');
const profile=await call(patient,'/api/care/profile',{name:'Синтетический пациент · проверка чата'});assert.equal(profile.status,200);
await call(doctor,'/api/care/doctor',{name:'Синтетический врач · проверка чата'});
const link=await call(doctor,'/api/care/claim',{code:profile.data.code});assert.equal(link.status,201);
const path='/api/care/links/'+link.data.id+'/messages';
assert.equal((await call(patient,path)).status,403);assert.equal((await call(doctor,path)).status,403);
assert.equal((await call(patient,'/api/care/links/'+link.data.id,{status:'active'})).status,200);
assert.deepEqual((await call(patient,path)).data.messages,[]);
assert.equal((await call(outsider,path)).status,404);
const message={id:randomUUID(),body:'Синтетический вопрос. Это проверка переписки.',senderRole:'doctor'};
const sent=await call(patient,path,message);assert.ok([200,201].includes(sent.status));assert.equal(sent.data.senderRole,'patient');assert.equal(sent.data.body,message.body);
const retry=await call(patient,path,message);assert.deepEqual(retry.data,sent.data);
assert.equal((await call(patient,path,{...message,body:'Изменённое сообщение'})).status,409);
assert.equal((await call(doctor,path,message)).status,409);
assert.equal((await call(patient,path,{id:randomUUID(),body:'Проверка CSRF'},false)).status,403);
const response=await call(doctor,path,{id:randomUUID(),body:'Синтетический ответ врача.'});assert.ok([200,201].includes(response.status));assert.equal(response.data.senderRole,'doctor');
for(let i=0;i<4;i++)assert.ok([200,201].includes((await call(patient,path,{id:randomUUID(),body:'Синтетическое сообщение '+i})).status));
const latest=await call(patient,path+'?limit=2');assert.equal(latest.status,200);assert.equal(latest.data.messages.length,2);assert.equal(latest.data.hasMore,true);assert.ok(latest.data.nextBefore);
const previous=await call(doctor,path+'?limit=2&before='+encodeURIComponent(latest.data.nextBefore));assert.equal(previous.status,200);assert.equal(previous.data.messages.length,2);assert.ok(previous.data.messages.every(row=>!latest.data.messages.some(other=>row.id===other.id)));
const full=await call(doctor,path+'?limit=100');assert.equal(full.data.messages.length,6);assert.equal(full.data.hasMore,false);assert.equal(full.data.nextBefore,null);
assert.equal((await call(patient,path+'?limit=101')).status,422);assert.equal((await call(patient,path+'?before=broken')).status,422);
assert.equal((await call(patient,'/api/care/links/'+link.data.id,{status:'revoked'})).status,200);
assert.equal((await call(patient,path)).status,403);assert.equal((await call(doctor,path)).status,403);assert.equal((await call(doctor,path,{id:randomUUID(),body:'Не должно сохраниться'})).status,403);
console.log(JSON.stringify({passed:true,syntheticOnly:true,messages:6,checks:'pending and outsider blocked, authenticated sender, CSRF, idempotent sends, conflict rejection, two-way messages, bounded cursor pagination, revocation blocks read and send'}));
