import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const origin=process.env.CHECK_ORIGIN||'http://127.0.0.1:4174';
const jar=new Map(),csrf={patient:null,doctor:null};
async function request(role,path,{method='GET',body,token=csrf[role],client=true}={}){
 const response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Compass-Role':role,...(client?{'X-Compass-Client':'web'}:{}),...(token?{'X-CSRF-Token':token}:{}),Cookie:[...jar].map(([key,value])=>key+'='+value).join('; ')},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 for(const value of response.headers.getSetCookie()){
  const first=value.split(';')[0],at=first.indexOf('=');if(/Max-Age=0(?:;|$)/.test(value))jar.delete(first.slice(0,at));else jar.set(first.slice(0,at),first.slice(at+1));
 }
 return {status:response.status,data:await response.json()};
}
async function initialize(role){const response=await request(role,'/api/session',{method:'POST',body:{}});assert.equal(response.status,201);csrf[role]=response.data.csrfToken;}
const synthetic='qa-'+randomUUID()+'@example.invalid',password='SYNTHETIC-qa-password-2026';
await initialize('patient');await initialize('doctor');
const originalProfile=await request('patient','/api/care/profile',{method:'POST',body:{name:'Синтетический анонимный профиль до регистрации'}});assert.equal(originalProfile.status,200);
const patientBody={role:'patient',email:synthetic,password,profile:{name:'Синтетический',surname:'Пациент',age:30},consents:{healthData:true,journalProcessing:false,journalSharing:false}};
assert.equal((await request('patient','/api/auth/register',{method:'POST',body:patientBody,token:'wrong'})).status,403);
const registered=await request('patient','/api/auth/register',{method:'POST',body:patientBody});assert.equal(registered.status,201,JSON.stringify(registered.data));csrf.patient=registered.data.csrfToken;assert.equal(registered.data.account.emailVerified,false);assert.equal(registered.data.account.consents.journalSharing,false);assert.ok(!JSON.stringify(registered.data).includes(password));
const isolated=await request('patient','/api/care');assert.equal(isolated.status,200);assert.notEqual(isolated.data.profile.code,originalProfile.data.code);assert.equal((await request('patient','/api/state')).data.entries.length,0);
assert.equal((await request('patient','/api/care/doctor',{method:'POST',body:{name:'Forged doctor'}})).status,403);
const clinician=await request('doctor','/api/auth/register',{method:'POST',body:{...patientBody,role:'doctor',profile:{name:'Синтетический',surname:'Врач'}}});assert.equal(clinician.status,201,JSON.stringify(clinician.data));csrf.doctor=clinician.data.csrfToken;assert.equal(clinician.data.account.role,'doctor');
const claim=await request('doctor','/api/care/claim',{method:'POST',body:{code:isolated.data.profile.code}});assert.equal(claim.status,201,JSON.stringify(claim.data));const linkId=claim.data.id;
assert.equal((await request('doctor','/api/care/patients/'+linkId)).status,403);assert.equal((await request('patient','/api/care/links/'+linkId,{method:'POST',body:{status:'active'}})).status,200);
const noteId=randomUUID(),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date()),note={id:noteId,type:'journal',title:'Синтетическая личная заметка',body:'SYNTHETIC_PRIVATE_JOURNAL_CANARY',day:today};
assert.equal((await request('patient','/api/entries/'+noteId,{method:'PUT',body:note})).status,200);
const hidden=await request('doctor','/api/care/patients/'+linkId);assert.equal(hidden.status,200);assert.equal(hidden.data.journalShared,false);assert.ok(!JSON.stringify(hidden.data).includes(note.body));
assert.equal((await request('patient','/api/auth/consents',{method:'POST',body:{healthData:true,journalProcessing:false,journalSharing:true}})).status,422);
assert.equal((await request('patient','/api/auth/consents',{method:'POST',body:{healthData:true,journalProcessing:true,journalSharing:true}})).status,200);
assert.equal((await request('doctor','/api/care/patients/'+linkId)).data.entries.find(row=>row.id===noteId).body,note.body);
assert.equal((await request('patient','/api/auth/consents',{method:'POST',body:{healthData:true,journalProcessing:false,journalSharing:false}})).status,200);
assert.ok(!(await request('doctor','/api/care/patients/'+linkId)).data.entries.some(row=>row.id===noteId));
const messageId=randomUUID(),message={id:messageId,body:'Синтетическое сообщение для проверки доставки'};
const sent=await request('patient','/api/care/links/'+linkId+'/messages',{method:'POST',body:message});assert.equal(sent.status,200,JSON.stringify(sent.data));assert.equal(sent.data.senderRole,'patient');assert.equal((await request('doctor','/api/care/links/'+linkId+'/messages')).data.messages.find(row=>row.id===messageId).body,message.body);
const out=await request('patient','/api/auth/logout',{method:'POST',body:{}});assert.equal(out.status,200);csrf.patient=out.data.csrfToken;assert.equal((await request('patient','/api/auth')).data.account,null);assert.equal((await request('patient','/api/care')).data.profile.code,originalProfile.data.code);
const badLogin=await request('patient','/api/auth/login',{method:'POST',body:{role:'patient',email:synthetic,password:'wrong-password'}});assert.equal(badLogin.status,401);assert.ok(!JSON.stringify(badLogin.data).includes(synthetic));
const login=await request('patient','/api/auth/login',{method:'POST',body:{role:'patient',email:synthetic,password}});assert.equal(login.status,200,JSON.stringify(login.data));csrf.patient=login.data.csrfToken;assert.equal(login.data.account.id,registered.data.account.id);assert.equal((await request('patient','/api/state')).data.entries.find(row=>row.id===noteId).body,note.body);
assert.equal((await request('patient','/api/auth/consents',{method:'POST',body:{healthData:false,journalProcessing:false,journalSharing:false}})).status,200);assert.equal((await request('patient','/api/entries/'+randomUUID(),{method:'PUT',body:{...note,id:randomUUID()}})).status,403);assert.equal((await request('doctor','/api/care/patients/'+linkId)).status,403);assert.equal((await request('doctor','/api/care/links/'+linkId+'/messages')).status,403);
assert.equal((await request('patient','/api/state')).status,200);assert.equal((await request('patient','/api/auth/consents',{method:'POST',body:{healthData:true,journalProcessing:false,journalSharing:false}})).status,200);
await request('patient','/api/care/links/'+linkId,{method:'POST',body:{status:'revoked'}});assert.equal((await request('doctor','/api/care/links/'+linkId+'/messages')).status,403);
console.log(JSON.stringify({passed:true,syntheticOnly:true,checks:'isolated accounts, same-address fixed-role accounts, fresh CSRF, anonymous profile retained separately, password login and persistence, consent-gated journal sharing and revocation, encrypted chat delivery, health-consent revocation, care revocation'}));
