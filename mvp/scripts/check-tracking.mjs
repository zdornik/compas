// New tracking features: fresh isolated synthetic DB only; never use a presentation account.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import pg from 'pg';
import {createStore} from '../server/store.mjs';
import {createApi} from '../server/api.mjs';
import {seedSyntheticHistory} from './synthetic-history.mjs';
import {unseal} from '../server/crypto.mjs';
import {dayKey} from '../src/domain.js';
import {historyOptions} from '../server/history.mjs';
assert.match(process.env.DB_NAME||'',/^compass_journal_qa_[a-f0-9]+$/);
const store=await createStore(),server=createServer(),connection={host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME};
const admin=new pg.Pool({...connection,user:'compass_admin',password:(await readFile(process.env.ADMIN_DB_PASSWORD_FILE,'utf8')).trim()}),runtime=new pg.Pool({...connection,user:'compass_app',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim()});
const key=Buffer.from((await readFile(process.env.DATA_KEY_FILE,'utf8')).trim(),'base64');
try{
 const fixture=await seedSyntheticHistory(store,{notes:1,days:14,plans:1}),{patient,doctor}=fixture.accounts,link=fixture.linkId;
 const second=await seedSyntheticHistory(store,{notes:0,days:0,plans:0});
 // Distinct registered patients, no journal sharing; roster must decrypt only allowed metrics.
 const invite=await store.care.profile(second.accounts.patient.session,'Анна Проверочная');
 const linked=await store.care.claim(doctor.session,invite.code);await store.care.consent(second.accounts.patient.session,linked.id,'active');
 const profile={id:'medical-profile',type:'medical-profile',expectedRevision:0,medications:[{id:'demo-med',name:'Синтетический препарат',details:''}],conditions:[{id:'demo-condition',name:'Синтетическое состояние',details:''}]};
 await store.saveEntry(patient.session.patient_id,profile.id,profile);
 let roster=await store.care.roster(doctor.session,new URLSearchParams());assert.equal(roster.items.length,2);assert.ok(roster.items.every(row=>row.status==='active'),'Both consenting patient rows must be readable');assert.equal(roster.items.find(row=>row.id===link).conditions[0]?.name,'Синтетическое состояние');
 let filtered=await store.care.roster(doctor.session,new URLSearchParams({diagnosis:'состояние',medication:'препарат'}));assert.deepEqual(filtered.items.map(row=>row.id),[link]);
 assert.equal(filtered.items[0].tracking.moodDays,14);assert.equal(filtered.items[0].tracking.mood.value,3);assert.ok(!JSON.stringify(filtered).includes('Старый личный текст'));assert.ok(!JSON.stringify(filtered).includes('Синтетический текст.'));
 const firstPage=await store.care.roster(doctor.session,new URLSearchParams({limit:1}));assert.ok(firstPage.nextCursor);
 const next=await store.care.roster(doctor.session,new URLSearchParams({limit:1,before:firstPage.nextCursor}));assert.notEqual(firstPage.items[0].id,next.items[0].id);
 await assert.rejects(()=>store.care.roster(doctor.session,new URLSearchParams({q:'другой',before:firstPage.nextCursor})),{status:400});
 await assert.rejects(()=>store.care.roster(second.accounts.doctor.session,new URLSearchParams({before:firstPage.nextCursor})),{status:400});
 assert.equal((await store.state(second.accounts.patient.session.patient_id)).entries.length,0,'Roster transaction marker must never leak into a pooled patient read');
 const input={id:randomUUID(),expectedRevision:0,kind:'anamnesis',method:'unspecified',title:'Вымышленное наблюдение',body:'Закрытый комментарий врача',day:dayKey()};
 const saved=await store.care.saveClinicalNote(doctor.session,link,input);assert.equal(saved.revision,1);
 assert.equal((await store.care.saveClinicalNote(doctor.session,link,input)).revision,1);
 const edited=await store.care.saveClinicalNote(doctor.session,link,{...input,expectedRevision:1,body:'Новая редакция'});assert.equal(edited.revision,2);
 await assert.rejects(()=>store.care.saveClinicalNote(doctor.session,link,{...input,body:'Устаревшая редакция'}),{status:409});
 await assert.rejects(()=>store.care.saveClinicalNote(doctor.session,linked.id,{...input,expectedRevision:2}),{status:404});
 await store.care.saveClinicalNote(doctor.session,link,{...input,id:randomUUID(),title:'Второй комментарий'});
 const notes=await store.care.clinicalNotes(doctor.session,link,new URLSearchParams({limit:1}));assert.ok(notes.nextCursor);assert.equal((await store.care.clinicalNotes(doctor.session,link,new URLSearchParams({before:notes.nextCursor}))).items.length,1);
 await assert.rejects(()=>store.care.clinicalNotes(doctor.session,linked.id,new URLSearchParams({before:notes.nextCursor})),{status:400});
 await assert.rejects(()=>store.care.clinicalNotes(second.accounts.doctor.session,link,new URLSearchParams()),{status:404});
 const raw=(await admin.query('SELECT * FROM care_clinical_notes WHERE id=$1',[input.id])).rows[0];assert.ok(!raw.payload.includes(Buffer.from('Новая редакция')));assert.equal(unseal(raw.payload,key,`clinical-note:${link}:${doctor.session.patient_id}:${input.id}:2`).body,'Новая редакция');
 assert.equal(Number((await admin.query('SELECT count(*) FROM care_clinical_note_versions WHERE note_id=$1',[input.id])).rows[0].count),2);
 // Actual RLS grants no comments to the patient or unrelated clinician, including immutable versions.
 const client=await runtime.connect();try{for(const principal of [patient.session.patient_id,second.accounts.doctor.session.patient_id]){await client.query('BEGIN');await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.patient_id',$1,true)",[principal]);assert.equal((await client.query('SELECT id FROM care_clinical_notes')).rowCount,0);assert.equal((await client.query('SELECT note_id FROM care_clinical_note_versions')).rowCount,0);await client.query('ROLLBACK');}}finally{client.release();}
 const sleep=await store.entry(patient.session.patient_id,'history-sleep-0');
 const sleepInput={...sleep,note:'Личный комментарий сна',expectedUpdatedAt:sleep.updatedAt};await store.saveEntry(patient.session.patient_id,sleep.id,sleepInput);
 await assert.rejects(()=>store.saveEntry(patient.session.patient_id,randomUUID(),{...sleepInput,id:randomUUID()}),{status:409});
 const options=historyOptions(new URLSearchParams({kind:'observations',from:dayKey(),to:dayKey()}));assert.equal((await store.care.history(doctor.session,link,options)).entries.find(row=>row.type==='sleep').note,'');
 assert.equal((await store.entry(patient.session.patient_id,sleep.id)).note,sleepInput.note);
 // Actual HTTP routing, role/CSRF checks and cache policy.
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,api=await createApi({store,siteOrigin:origin});server.on('request',(req,res)=>api(req,res,new URL(req.url,origin).pathname));
 const request=async(role,path,method='GET',body)=>{const acc=fixture.accounts[role],response=await fetch(origin+path,{method,headers:{Origin:origin,'X-Compass-Role':role,'X-Compass-Client':'web','Content-Type':'application/json',Cookie:'compass_session'+(role==='doctor'?'_doctor':'')+'='+acc.token},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.headers.get('cache-control'),'no-store');return response.status;};
 assert.equal(await request('doctor','/api/care/roster'),200);assert.equal(await request('patient','/api/care/roster'),403);assert.equal(await request('patient','/api/care/patients/'+link+'/clinical-notes'),403);assert.equal(await request('doctor','/api/care/patients/'+link+'/clinical-notes','POST',input),403);
 await store.auth.consents(patient.session,{healthData:false,journalProcessing:false,journalSharing:false});roster=await store.care.roster(doctor.session,new URLSearchParams());assert.equal(roster.items.find(row=>row.id===link).status,'restricted');assert.deepEqual(roster.items.find(row=>row.id===link).medications,[]);await assert.rejects(()=>store.care.clinicalNotes(doctor.session,link,new URLSearchParams()),{status:403});
 await store.auth.consents(doctor.session,{healthData:false,journalProcessing:false,journalSharing:false});await assert.rejects(()=>store.care.roster(doctor.session,new URLSearchParams()),{status:403});await assert.rejects(()=>store.care.clinicalNotes(doctor.session,linked.id,new URLSearchParams()),{status:403});
 console.log('Tracking integration passed: two patients, batch roster, filters/cursors, RLS/consent, encrypted private doctor comments, versions/retries, sleep deduplication/redaction, actual API role/CSRF guards.');
}finally{await new Promise(resolve=>server.close(resolve));await Promise.all([store.close(),admin.end(),runtime.end()]);}
