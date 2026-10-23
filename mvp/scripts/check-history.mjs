import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createStore} from '../server/store.mjs';
import {createApi} from '../server/api.mjs';
import {historyOptions} from '../server/history.mjs';
import {seedSyntheticHistory} from './synthetic-history.mjs';
import {dayKey} from '../src/domain.js';
import {medicationDoseId} from '../src/medications.js';
const store=await createStore(),server=createServer();
try{
  const fixture=await seedSyntheticHistory(store,{plans:130}),{patient,doctor}=fixture.accounts;
  const state=await store.state(patient.session.patient_id);
  assert.equal(state.entries.filter(row=>row.type==='medication-plan').length,130,'Old active schemes must never be paged away');
  assert.ok(!state.entries.some(row=>row.type==='journal'));
  assert.equal(state.entries.filter(row=>row.type==='mood').length,1);
  assert.equal((await store.state(patient.session.patient_id,state.revision)).unchanged,true);
  const all=[];let before;
  do{
    const page=await store.history(patient.session.patient_id,historyOptions(new URLSearchParams({kind:'notes',limit:17,...(before?{before}:{})})));
    assert.ok(page.entries.length<=17);assert.ok(page.entries.every(row=>row.body===undefined&&row.excerpt.length<=240));all.push(...page.entries);before=page.nextCursor;
  }while(before);
  assert.equal(all.length,fixture.notes);assert.equal(new Set(all.map(row=>row.id)).size,fixture.notes);
  let searchCursor,matched=[];
  do{
    const page=await store.history(patient.session.patient_id,historyOptions(new URLSearchParams({kind:'notes',q:'Искомый архивный текст',...(searchCursor?{before:searchCursor}:{})})));
    matched.push(...page.entries);searchCursor=page.nextCursor;
  }while(searchCursor);
  assert.deepEqual(matched.map(row=>row.id),['history-note-'+(fixture.notes-1)]);
  const oldest=await store.entry(patient.session.patient_id,'history-note-'+(fixture.notes-1));assert.ok(oldest.body.includes('Искомый архивный текст.'));
  const oldOptions=historyOptions(new URLSearchParams({kind:'observations',from:fixture.oldDay,to:fixture.oldDay}));
  assert.equal((await store.history(patient.session.patient_id,oldOptions)).entries.length,2);
  const redacted=await store.care.history(doctor.session,fixture.linkId,oldOptions);
  assert.equal(redacted.entries.find(row=>row.type==='mood').note,'');
  const page=await store.history(patient.session.patient_id,historyOptions(new URLSearchParams({kind:'notes',limit:1})));
  const doseId=medicationDoseId(fixture.planIds[0],fixture.oldDay,'09:00');
  await store.saveEntry(patient.session.patient_id,doseId,{id:doseId,type:'medication-dose',planId:fixture.planIds[0],day:fixture.oldDay,time:'09:00',status:'taken',expectedRevision:0});
  const doses=await store.history(patient.session.patient_id,historyOptions(new URLSearchParams({kind:'doses',from:fixture.oldDay,to:fixture.oldDay})));
  assert.equal(doses.entries[0].status,'taken');assert.notEqual((await store.state(patient.session.patient_id)).revision,state.revision);
  await assert.rejects(()=>store.history(patient.session.patient_id,historyOptions(new URLSearchParams({kind:'notes',before:page.nextCursor}))),{code:'HISTORY_CHANGED'});
  // Check actual routes, role isolation, cache policy, cursors and revocation.
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const api=await createApi({store,siteOrigin:origin});server.on('request',(req,res)=>api(req,res,new URL(req.url,origin).pathname));
  const get=async(role,path)=>{const response=await fetch(origin+path,{headers:{Origin:origin,'X-Compass-Role':role,Cookie:'compass_session'+(role==='doctor'?'_doctor':'')+'='+fixture.accounts[role].token}});assert.equal(response.headers.get('cache-control'),'no-store');return {status:response.status,data:await response.json()};};
  assert.equal((await get('patient','/api/history?kind=notes')).status,200);
  assert.equal((await get('doctor','/api/history?kind=notes')).status,403);
  assert.equal((await get('doctor','/api/entries/'+oldest.id)).status,403);
  assert.equal((await get('doctor','/api/care/patients/'+fixture.linkId+'/history?kind=notes')).status,400);
  const cursorResponse=await get('patient','/api/history?kind=notes&before='+encodeURIComponent(page.nextCursor));assert.equal(cursorResponse.status,409);assert.equal(cursorResponse.data.code,'HISTORY_CHANGED');
  assert.equal((await get('patient','/api/entries/'+randomUUID())).status,404);
  await store.care.consent(patient.session,fixture.linkId,'revoked');
  assert.equal((await get('doctor','/api/care/patients/'+fixture.linkId+'/history?kind=observations&from='+dayKey()+'&to='+dayKey())).status,403);
  console.log('History integration passed: 500 long notes, 365 days, 130 old active schemes, full text, cursor invalidation, historic dose, redaction, roles and revocation.');
}finally{await new Promise(resolve=>server.close(resolve));await store.close();}
