import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {createApi} from '../server/api.mjs';
import {createCareStore} from '../server/care-store.mjs';
import {createAuthStore} from '../server/auth-store.mjs';
import {seal} from '../server/crypto.mjs';
import {normalizeLogin,loginHash,hashPassword,verifyPassword,validateRegistration,validateConsents,consentUpdate,createAuthLimiter,CONSENT_VERSION} from '../server/auth-policy.mjs';
const registration={role:'patient',email:' TEST@Example.org ',password:'длинный-пароль-2026',profile:{name:' Тест ',surname:' Пациент ',age:31},consents:{healthData:true}};
test('account inputs have fixed roles, bounded identity fields and explicit independent journal consent',()=>{
 const value=validateRegistration(registration);assert.equal(value.email,'test@example.org');assert.equal(value.profile.name,'Тест');assert.deepEqual(value.consents,{healthData:true,journalProcessing:false,journalSharing:false});assert.match(CONSENT_VERSION,/2026-10-19/);
 for(const input of [{...registration,role:'admin'},{...registration,password:'short'},{...registration,password:'x'.repeat(129)},{...registration,profile:{...registration.profile,age:0}},{...registration,consents:{}},{...registration,consents:{healthData:true,journalSharing:true}},{...registration,consents:{healthData:true,journalProcessing:'true'}}])assert.throws(()=>validateRegistration(input));
 assert.throws(()=>normalizeLogin('a\nb@example.org'));assert.throws(()=>validateConsents({healthData:true,journalProcessing:false,journalSharing:true}));
 assert.deepEqual(validateConsents({healthData:false,journalProcessing:false,journalSharing:false}),{healthData:false,journalProcessing:false,journalSharing:false,journalAiProcessing:false});
 const key=randomBytes(32);assert.equal(loginHash(value.email,key).length,64);assert.notEqual(loginHash(value.email,key),loginHash(value.email,randomBytes(32)));
});
test('scrypt hashes are individually salted and do not accept wrong or malformed credentials',async()=>{
 const one=await hashPassword(registration.password),two=await hashPassword(registration.password);assert.notEqual(one,two);assert.doesNotMatch(one,/длинный|пароль/);assert.equal(await verifyPassword(registration.password,one),true);assert.equal(await verifyPassword('wrong-password',one),false);assert.equal(await verifyPassword(registration.password,null),false);assert.equal(await verifyPassword('x'.repeat(200),one),false);assert.equal(await verifyPassword(registration.password,'scrypt-v1:bad:bad'),false);
});
test('auth throttles repeated attempts and expires counters without unbounded key retention',()=>{
 let clock=1;const allow=createAuthLimiter({now:()=>clock,maxKeys:3});assert.equal(allow('user',2,100),true);assert.equal(allow('user',2,100),true);assert.equal(allow('user',2,100),false);clock=102;assert.equal(allow('user',2,100),true);for(let i=0;i<100;i++)assert.equal(allow('key'+i),true);
});
test('role discovery verifies credentials for each account and never changes the registered role',async()=>{
 const key=randomBytes(32),patientPassword='Synthetic-patient-2026',doctorPassword='Synthetic-doctor-2026';
 const candidates=await Promise.all(['patient','doctor'].map(async(role,index)=>({id:role,principal_id:role+'-principal',role,password_hash:await hashPassword(index?doctorPassword:patientPassword),payload:seal({email:'shared@example.invalid',profile:{name:'Test'},consents:{}},key,'auth-account:'+role)})));
 let insertedRole;
 const db={query:async(sql,params)=>{if(sql==='SELECT * FROM auth_accounts WHERE login_hash=$1')return {rows:candidates};if(sql.includes('INSERT INTO app_sessions'))insertedRole=params[3];return {rows:[]};}};
 const store=createAuthStore({key,transaction:async(_id,callback)=>callback(db)});
 const result=await store.login({email:'shared@example.invalid',password:doctorPassword,role:'patient',discoverRole:true});
 assert.equal(result.account.role,'doctor');assert.equal(insertedRole,true);
 assert.equal((await store.login({email:'shared@example.invalid',password:patientPassword,role:'doctor',discoverRole:true})).account.role,'patient');
 await assert.rejects(()=>store.login({email:'shared@example.invalid',password:'wrong-password',role:'patient',discoverRole:true}),{status:401});
});
test('stale consent settings cannot restore revoked permissions; identical retries create no new event version',()=>{
 const before={consents:{healthData:true,journalProcessing:true,journalSharing:true},consentVersion:CONSENT_VERSION,consentUpdatedAt:'2026-10-19T00:00:00.000Z'},input={healthData:true,journalProcessing:false,journalSharing:false,expectedConsentUpdatedAt:before.consentUpdatedAt};
 const revoked=consentUpdate(before,input,new Date(before.consentUpdatedAt));assert.equal(revoked.consentUpdatedAt,'2026-10-19T00:00:00.001Z');assert.equal(revoked.consents.journalSharing,false);
 assert.throws(()=>consentUpdate(revoked,{...before.consents,expectedConsentUpdatedAt:before.consentUpdatedAt}),{status:409});
 assert.equal(consentUpdate(revoked,input),null);
 assert.equal(consentUpdate(revoked,{...before.consents,expectedConsentUpdatedAt:revoked.consentUpdatedAt}).consents.journalSharing,true);
});
const origin='http://127.0.0.1:4174',anonToken='a'.repeat(64),accountToken='b'.repeat(64),anon={patient_id:'11111111-1111-4111-8111-111111111111',token_hash:'anon',csrf_token:'anon-csrf',doctor_enabled:false},account={...anon,token_hash:'account',csrf_token:'account-csrf',account_id:'account-id',account_role:'patient'};
const makeRequest=async(api,path,{method='GET',input,role='patient',token=anonToken,csrf='anon-csrf',extraCookies='',client='web',accountHint}={})=>{
 const req=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]);req.method=method;req.url=path;req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'127.0.0.1:4174',origin,'content-type':'application/json','x-compass-role':role,'x-compass-client':client,...(accountHint!==undefined?{'x-compass-account':accountHint}:{}),...(csrf?{'x-csrf-token':csrf}:{}),cookie:`compass_session=${token}; compass_session_doctor=${token}${extraCookies}`};
 const result={headers:{}};const res={setHeader(name,value){result.headers[name]=value;},writeHead(status,headers){result.status=status;Object.assign(result.headers,headers);},end(body){result.data=JSON.parse(body);}};await api(req,res,path.split('?')[0]);return result;
};
const fakeStore=()=>{
 const calls=[];return {calls,session:async token=>token===anonToken?anon:token===accountToken?account:null,auth:{current:async session=>({account:session?.account_id?{id:'account-id',role:'patient'}:null}),register:async input=>{calls.push(['register',input]);return {token:accountToken,csrfToken:'new-csrf',account:{id:'new-account',role:input.role}};},login:async()=>({token:accountToken,csrfToken:'login-csrf',account:{id:'new-account',role:'patient'}}),logout:async()=>{calls.push(['logout']);},requireHealthConsent:async()=>{},consents:async()=>({})},care:{doctor:async()=>{calls.push(['doctor']);return {};}}};
};
test('auth endpoints require origin-bound client CSRF and retain anonymous profile in a separate opaque cookie',async()=>{
 const store=fakeStore(),api=await createApi({store,siteOrigin:origin});
 assert.equal((await makeRequest(api,'/api/auth/register',{method:'POST',input:registration,csrf:''})).status,403);assert.equal(store.calls.length,0);
 assert.equal((await makeRequest(api,'/api/auth/register',{method:'POST',input:{...registration,role:'doctor'}})).status,422);
 const created=await makeRequest(api,'/api/auth/register',{method:'POST',input:registration});assert.equal(created.status,201);assert.equal(created.data.csrfToken,'new-csrf');assert.equal(created.data.token,undefined);assert.equal(created.headers['Set-Cookie'].length,2);assert.match(created.headers['Set-Cookie'][0],/HttpOnly; SameSite=Strict; Path=\/api/);assert.match(created.headers['Set-Cookie'][1],/compass_session_local=/);
 const out=await makeRequest(api,'/api/auth/logout',{method:'POST',input:{},token:accountToken,csrf:'account-csrf',extraCookies:'; compass_session_local='+anonToken});assert.equal(out.status,200);assert.equal(out.data.csrfToken,'anon-csrf');assert.match(out.headers['Set-Cookie'],new RegExp(anonToken));
});
test('role selection cannot turn a patient account into a clinician and repeated auth failures are throttled',async()=>{
 const store=fakeStore(),api=await createApi({store,siteOrigin:origin});
 const blocked=await makeRequest(api,'/api/care/doctor',{method:'POST',input:{name:'Forged'},token:accountToken,csrf:'account-csrf'});assert.equal(blocked.status,403);assert.ok(!store.calls.some(([action])=>action==='doctor'));
 assert.equal((await makeRequest(api,'/api/state',{token:accountToken,csrf:'account-csrf',role:'doctor'})).status,403);
 store.auth.login=async()=>{throw Object.assign(new Error('Не удалось войти'),{status:401});};
 for(let attempt=0;attempt<8;attempt++)assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input:{...registration,email:'rate@example.org'}})).status,401);
 const limited=await makeRequest(api,'/api/auth/login',{method:'POST',input:{...registration,email:'rate@example.org'}});
 assert.equal(limited.status,429);assert.equal(limited.data.code,'AUTH_RATE_LIMITED');assert.ok(Number(limited.headers['Retry-After'])>0);
});
test('successful sign-ins do not exhaust failure limits and do not erase other users IP failures',async()=>{
 const store=fakeStore(),api=await createApi({store,siteOrigin:origin});
 const input={...registration,email:'success@example.org'};
 for(let i=0;i<50;i++)assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input})).status,200);
 store.auth.login=async value=>{if(value.email.startsWith('fail'))throw Object.assign(new Error('credentials'),{status:401});return {token:accountToken,csrfToken:'new-csrf',account:{role:'patient'}};};
 for(let i=0;i<7;i++)assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input:{...input,email:'fail@example.org'}})).status,401);
 assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input})).status,200);
 assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input:{...input,email:'fail@example.org'}})).status,401);
 assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input:{...input,email:'fail@example.org'}})).status,429);
 for(let i=0;i<31;i++)assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input:{...input,email:'fail-'+i+'@example.org'}})).status,401);
 assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input})).status,200);
 assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input:{...input,email:'fail-last@example.org'}})).status,401);
 assert.equal((await makeRequest(api,'/api/auth/login',{method:'POST',input:{...input,email:'fail-blocked@example.org'}})).status,429);
});
test('discovered doctor login rotates only doctor cookies and preserves the anonymous doctor profile',async()=>{
 const store=fakeStore();store.auth.login=async()=>({token:accountToken,csrfToken:'doctor-csrf',account:{id:'doctor-id',role:'doctor'}});
 const api=await createApi({store,siteOrigin:origin});
 const result=await makeRequest(api,'/api/auth/login',{method:'POST',input:{...registration,discoverRole:true}});
 assert.equal(result.status,200);assert.equal(result.data.account.role,'doctor');
 assert.match(result.headers['Set-Cookie'][0],/^compass_session_doctor=/);
 assert.match(result.headers['Set-Cookie'][1],/^compass_session_doctor_local=/);
 assert.ok(result.headers['Set-Cookie'].every(value=>!value.startsWith('compass_session=')));
});
test('an expected account hint blocks stale cross-tab drafts without granting permissions',async()=>{
 const store=fakeStore(),api=await createApi({store,siteOrigin:origin});
 const blocked=await makeRequest(api,'/api/auth/logout',{method:'POST',input:{},token:accountToken,csrf:'account-csrf',accountHint:'different-account'});assert.equal(blocked.status,409);assert.equal(blocked.data.code,'ACCOUNT_CHANGED');assert.ok(!store.calls.some(([action])=>action==='logout'));
 assert.equal((await makeRequest(api,'/api/state',{token:accountToken,csrf:'account-csrf',accountHint:'local'})).status,409);
 assert.equal((await makeRequest(api,'/api/care/doctor',{method:'POST',input:{name:'Forged'},token:accountToken,csrf:'account-csrf',accountHint:'account-id'})).status,403);
 assert.equal((await makeRequest(api,'/api/auth',{token:accountToken,csrf:'account-csrf',accountHint:'different-account'})).status,200);
});
test('physician journal access checks global consent before decrypting and revocation hides legacy mood notes',async()=>{
 const key=randomBytes(32),patientId='11111111-1111-4111-8111-111111111111',doctorId='22222222-2222-4222-8222-222222222222',linkId='33333333-3333-4333-8333-333333333333',accountId='44444444-4444-4444-8444-444444444444';
 let shared=false,health=true,decoded=[];
 const link={id:linkId,patient_id:patientId,doctor_id:doctorId,status:'active',payload:seal({patientName:'Test',doctorName:'Doctor'},key,'care-link:'+linkId)};
 const db={async query(sql,params){
  if(sql.includes('FROM care_links'))return {rows:[link]};
  if(sql.includes('FROM auth_accounts'))return {rows:[{id:accountId,payload:seal({consents:{healthData:health,journalProcessing:shared,journalSharing:shared}},key,'auth-account:'+accountId)}]};
  if(sql.includes('FROM patient_entries')){assert.match(sql,/type<>'journal'/);return {rows:[{id:'mood',payload:{type:'mood',note:'Private legacy note'}},...(params[0]?[{id:'journal',payload:{type:'journal',body:'Private journal'}}]:[])]};}
  return {rows:[]};
 }};
 const care=createCareStore({transaction:async(_id,callback)=>callback(db),key,decode:row=>{decoded.push(row.id);return row.payload;}}),session={patient_id:doctorId,doctor_enabled:true};
 const hidden=await care.patient(session,linkId);assert.equal(hidden.journalShared,false);assert.equal(hidden.entries[0].note,'');assert.ok(!decoded.includes('journal'));
 shared=true;decoded=[];const open=await care.patient(session,linkId);assert.equal(open.journalShared,true);assert.equal(open.entries.some(row=>row.type==='journal'),false);assert.ok(!decoded.includes('journal')); // Full text is served only by the dedicated notes API.
 shared=false;assert.equal((await care.patient(session,linkId)).entries.some(row=>row.type==='journal'),false);
 health=false;await assert.rejects(()=>care.patient(session,linkId),{status:403});
});
