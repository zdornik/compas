// Destructive test fixtures are permitted only in an explicitly isolated QA database.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {createStore} from '../server/store.mjs';
import {createApi} from '../server/api.mjs';
import {dayKey} from '../src/domain.js';
import {appointmentStart,appointmentDayAfter} from '../src/appointments.js';

assert.match(process.env.DB_NAME||'',/^compass_(?:journal|appointments)_qa_[a-f0-9]+$/,'Use an isolated QA database');
const password='Synthetic-appointments-2026',store=await createStore(),server=createServer(),clients={},accounts={};let origin;
const connection={host:process.env.DB_HOST||'127.0.0.1',database:process.env.DB_NAME,port:Number(process.env.DB_PORT||5432)};
const admin=new pg.Pool({...connection,user:'compass_admin',password:(await readFile(process.env.ADMIN_DB_PASSWORD_FILE,'utf8')).trim()});
const runtime=new pg.Pool({...connection,user:'compass_app',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim()});
async function request(name,path,{body,method=body===undefined?'GET':'POST',expected=200}={}){
 const client=clients[name],response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Compass-Client':'web','X-Compass-Role':client.role,...(client.csrf?{'X-CSRF-Token':client.csrf}:{}),Cookie:[...client.jar].map(([k,v])=>k+'='+v).join('; ')},...(body===undefined?{}:{body:JSON.stringify(body)})});
 for(const value of response.headers.getSetCookie()){const first=value.split(';')[0],at=first.indexOf('=');client.jar.set(first.slice(0,at),first.slice(at+1));}
 const data=await response.json();if(data.csrfToken)client.csrf=data.csrfToken;
 if(expected!==null)assert.equal(response.status,expected,JSON.stringify({name,path,status:response.status,data}));
 return {status:response.status,data};
}
const nextAction=(revision=1)=>({expectedRevision:revision,mutationId:randomUUID()});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 const api=await createApi({store,siteOrigin:origin});server.on('request',(req,res)=>api(req,res,new URL(req.url,origin).pathname));
 for(const [name,role] of [['p1','patient'],['p2','patient'],['d1','doctor'],['d2','doctor']]){
  clients[name]={role,jar:new Map()};await request(name,'/api/session',{body:{},expected:201});
  const email='appointment-'+name+'-'+randomUUID()+'@example.invalid';
  const result=await request(name,'/api/auth/register',{expected:201,body:{role,email,password,profile:{name:'Проверка',surname:name,...(role==='patient'?{age:30}:{})},consents:{healthData:true}}});accounts[name]=result.data.account;
 }
 const connect=async(patient,doctor)=>{
  const care=(await request(patient,'/api/care')).data;
  const link=(await request(doctor,'/api/care/claim',{body:{code:care.profile.code},expected:201})).data;
  await request(patient,'/api/care/links/'+link.id,{body:{status:'active'}});return link.id;
 };
 const linkA=await connect('p1','d1'),linkB=await connect('p2','d1'),linkC=await connect('p1','d2');
 const day=appointmentDayAfter(dayKey(),5),input=(linkId,time='09:00',durationMinutes=30)=>({id:randomUUID(),linkId,startsAt:appointmentStart(day,time),durationMinutes,format:'online',note:'SYNTHETIC_APPOINTMENT_PRIVATE_CANARY'});
 const create=(name,body,expected=201)=>request(name,'/api/appointments',{body,expected});
 const change=(name,id,action,body=nextAction(),expected=200)=>request(name,'/api/appointments/'+id+'/'+action,{body,expected});
 clients.ad={role:'doctor',jar:new Map()};await request('ad','/api/session',{body:{},expected:201});await request('ad','/api/care/doctor',{body:{name:'Синтетический прежний локальный врач'}});
 const anonymousLink=await connect('p2','ad');await create('p2',input(anonymousLink,'17:00'),403);await create('ad',input(anonymousLink,'17:00'),401);
 const requested=input(linkA),first=(await create('p1',requested)).data;assert.equal(first.status,'requested');assert.equal(first.createdByRole,'patient');
 assert.equal((await create('p1',requested)).data.id,first.id);await create('p1',{...requested,note:'Different payload'},409);
 await change('p1',first.id,'confirm',nextAction(),403);await change('p2',first.id,'cancel',nextAction(),404);
 const approve=nextAction(),confirmed=(await change('d1',first.id,'confirm',approve)).data;assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.revision,2);
 assert.equal((await change('d1',first.id,'confirm',approve)).data.revision,2);await change('d1',first.id,'cancel',nextAction(),409);
 await create('d1',input(linkB,'09:15'),409);await create('d2',input(linkC,'09:15'),409);
 const adjacent=(await create('d1',input(linkA,'09:30'))).data;assert.equal(adjacent.status,'confirmed');assert.equal(adjacent.createdByRole,'doctor');
 const cancel=nextAction(adjacent.revision);await change('p1',adjacent.id,'cancel',cancel);assert.equal((await change('p1',adjacent.id,'cancel',cancel)).data.status,'cancelled');
 assert.equal((await create('d1',input(linkB,'09:30'))).data.status,'confirmed');
 const one=(await create('p1',input(linkA,'11:00'))).data,two=(await create('p2',input(linkB,'11:00'))).data;
 const race=await Promise.all([change('d1',one.id,'confirm',nextAction(),null),change('d1',two.id,'confirm',nextAction(),null)]);assert.deepEqual(race.map(value=>value.status).sort(),[200,409]);
 const cross=(await create('d2',input(linkC,'23:45'))).data,next=appointmentDayAfter(day,1);
 assert.ok((await request('p1','/api/appointments?from='+next+'&to='+next)).data.items.some(value=>value.id===cross.id),'Appointments crossing midnight remain visible next day');
 const page1=(await request('d1','/api/appointments?from='+day+'&to='+day+'&limit=1')).data;assert.equal(page1.items.length,1);assert.ok(page1.nextAfter);
 const page2=(await request('d1','/api/appointments?from='+day+'&to='+day+'&limit=1&after='+page1.nextAfter)).data;assert.notEqual(page2.items[0].id,page1.items[0].id);
 assert.ok(!(await request('p2','/api/appointments')).data.items.some(value=>value.id===first.id));
 const cipher=(await admin.query('SELECT payload FROM care_appointments WHERE id=$1',[first.id])).rows[0].payload;assert.ok(!cipher.toString('utf8').includes('CANARY'));
 assert.equal(Number((await admin.query('SELECT count(*) FROM care_appointment_events WHERE appointment_id=$1',[first.id])).rows[0].count),2,'Confirmation retry creates no duplicate event');
 const db=await runtime.connect();
 try{await db.query('BEGIN');await db.query("SELECT set_config('app.actor_id',$1,true)",[(await admin.query('SELECT principal_id FROM auth_accounts WHERE id=$1',[accounts.p2.id])).rows[0].principal_id]);assert.equal((await db.query('SELECT id FROM care_appointments WHERE id=$1',[first.id])).rows.length,0);await db.query('ROLLBACK');await assert.rejects(()=>db.query('UPDATE care_appointment_events SET revision=42'),{code:'42501'});}finally{db.release();}
 await request('p1','/api/care/links/'+linkC,{body:{status:'revoked'}});
 assert.ok(!(await request('d2','/api/appointments')).data.items.some(value=>value.id===cross.id));
 assert.equal((await request('p1','/api/appointments')).data.items.find(value=>value.id===cross.id).status,'cancelled');
 await request('p1','/api/auth/consents',{body:{healthData:false,journalProcessing:false,journalSharing:false}});
 assert.ok(!(await request('d1','/api/appointments')).data.items.some(value=>value.id===first.id));
 assert.equal((await request('p1','/api/appointments')).data.items.find(value=>value.id===first.id).status,'cancelled');
 await create('p1',input(linkA,'15:00'),403);
 const remaining=(await create('p2',input(linkB,'16:00'))).data;assert.equal((await change('d1',remaining.id,'decline')).data.status,'declined');
 if(process.env.APPOINTMENT_QA_UI_FILE){
  await request('p1','/api/auth/consents',{body:{healthData:true,journalProcessing:false,journalSharing:false}});
  await writeFile(process.env.APPOINTMENT_QA_UI_FILE,JSON.stringify({patient:accounts.p1.email,doctor:accounts.d1.email,password,linkId:linkA,day},null,2),{mode:0o600});
 }
 console.log(JSON.stringify({passed:true,syntheticOnly:true,checks:'patient requests, physician appointments, role authorization, encrypted events, exact retries, stale actions, adjacent intervals, patient/doctor conflicts, concurrent confirmation, Moscow dates, midnight overlap, cursor pagination, RLS, revocation and consent withdrawal'}));
}finally{await new Promise(resolve=>server.close(resolve));await Promise.all([store.close(),admin.end(),runtime.end()]);}
