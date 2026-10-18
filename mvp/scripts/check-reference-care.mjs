import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const origin=process.env.CHECK_ORIGIN||'http://127.0.0.1:4174';
const jar=[];
async function create(role){const response=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'X-Compass-Client':'web','X-Compass-Role':role,Cookie:jar.join('; ')}});assert.equal(response.status,201);jar.push(response.headers.get('set-cookie').split(';')[0]);return {role,csrf:(await response.json()).csrfToken};}
async function call(actor,path,body,method=body?'POST':'GET'){const response=await fetch(origin+path,{method,headers:{Origin:origin,Cookie:jar.join('; '),'X-Compass-Role':actor.role,'X-CSRF-Token':actor.csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
const patient=await create('patient'),doctor=await create('doctor');
assert.notEqual(patient.csrf,doctor.csrf);assert.equal(jar.length,2);assert.match(jar[1],/_doctor=/);
const profile=(await call(patient,'/api/care/profile',{name:'Проверка интерфейса · синтетический профиль'})).data;assert.match(profile.code,/^[A-F0-9]{12}$/);assert.equal((await call(patient,'/api/care/profile',{name:profile.name})).data.code,profile.code);
await call(doctor,'/api/care/doctor',{name:'Врач · синтетическая проверка'});
const link=await call(doctor,'/api/care/claim',{code:profile.code});assert.equal(link.status,201,JSON.stringify(link.data));const id=link.data.id;
assert.equal((await call(doctor,'/api/care/patients/'+id)).status,403);await call(patient,'/api/care/profile',{name:'Проверка переименования · синтетический профиль'});assert.equal((await call(patient,'/api/care/links/'+id,{status:'active'})).status,200);assert.equal((await call(doctor,'/api/care/patients/'+id)).data.link.patientName,'Проверка переименования · синтетический профиль');
const suggestions=await (await fetch(origin+'/api/knowledge/suggestions?q='+encodeURIComponent('сертралин'))).json();assert.ok(suggestions.substances.some(row=>row.name==='Сертралин'));
const substance=suggestions.substances.find(row=>row.name==='Сертралин');const products=await (await fetch(origin+'/api/knowledge/substance-products?id='+encodeURIComponent(substance.id))).json();assert.ok(products.items.length);assert.ok(products.items[0].instructionDocumentId);
for(const [query,code] of [['гипертония','I10'],['гипертензия','I10'],['БАР','F31'],['ОКР','F42'],['гипертензия новорожденного','P29.2']]){const found=await (await fetch(origin+'/api/knowledge/conditions?q='+encodeURIComponent(query))).json();assert.equal(found.items[0].code,code);}
const conditions=await (await fetch(origin+'/api/knowledge/conditions?q=G40')).json();assert.equal(conditions.items[0].code,'G40');
const quetiapine=(await (await fetch(origin+'/api/knowledge/suggestions?q='+encodeURIComponent('кветиапин'))).json()).substances.find(row=>row.name==='Кветиапин');assert.ok(quetiapine);
const current=(await (await fetch(origin+'/api/knowledge/substance-products?id='+encodeURIComponent(quetiapine.id))).json()).items[0];
const medical={id:'medical-profile',type:'medical-profile',expectedRevision:0,medications:[{id:'current',name:'Forged display',productId:current.id,details:'Только тест'}],conditions:[{id:'condition',name:'Forged diagnosis',icd10:'G40',details:'Только тест'}]};
const saved=await call(patient,'/api/entries/medical-profile',medical,'PUT');assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.conditions[0].name,'Эпилепсия');assert.equal(saved.data.medications[0].name,current.tradeName);
const changed=await call(doctor,'/api/care/patients/'+id+'/medical-profile',{...medical,expectedRevision:1,conditions:[{...medical.conditions[0],details:'Уточнение врача · тест'}]});assert.equal(changed.status,200,JSON.stringify(changed.data));assert.equal(changed.data.conditions[0].source.type,'doctor');assert.equal(changed.data.history.length,1);
assert.equal((await call(doctor,'/api/care/patients/'+id+'/medical-profile',{...medical,expectedRevision:1,conditions:[]})).status,409);
const state=(await call(patient,'/api/state')).data;assert.equal(state.entries.find(row=>row.id==='medical-profile').updatedBy.type,'doctor');
const product=products.items[0],planId=randomUUID(),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
const plan={id:planId,expectedRevision:0,name:product.tradeName,form:'tablet',unit:'мг',strength:50,quantity:1,meal:'unspecified',times:['23:59'],startDate:today,endDate:null,instructions:'SYNTHETIC QA ONLY',archived:false,titration:{enabled:false,after:'maintain',stages:[]}};
const report=await call(doctor,'/api/care/patients/'+id+'/check',{productId:product.id,documentId:product.instructionDocumentId,planId,plan});assert.equal(report.status,200,JSON.stringify(report.data));assert.equal(report.data.coverage.ddinter.loadedPairs,295183);assert.ok(report.data.interactions.length);assert.ok(report.data.diseaseInteractions.some(row=>row.icd10==='G40'));assert.equal(report.data.safeToCombine,null);

const registryHistory=await (await fetch(origin+'/api/knowledge/products?q='+encodeURIComponent('Сертралин')+'&allStatuses=1&limit=100')).json();
const withoutPdf=registryHistory.items.find(row=>row.inn==='Сертралин'&&!row.instructionDocumentId);assert.ok(withoutPdf);
const documentFree=await call(doctor,'/api/care/patients/'+id+'/check',{productId:withoutPdf.id,documentId:null,planId,plan:{...plan,name:withoutPdf.tradeName}});
assert.equal(documentFree.status,200,JSON.stringify(documentFree.data));assert.ok(documentFree.data.interactions.length);assert.equal(documentFree.data.document,null);assert.equal(documentFree.data.coverage.instruction.status,'not_selected');assert.equal(documentFree.data.safeToCombine,null);
assert.ok(report.data.interactions.some(row=>row.drugANameRu&&row.drugBNameRu));
assert.ok(report.data.diseaseInteractions.some(row=>row.drugNameRu));
assert.ok(products.items[0].form);
const delivered=await call(doctor,'/api/care/patients/'+id+'/prescriptions',{plan,productId:product.id,documentId:product.instructionDocumentId,reviewedFingerprint:report.data.fingerprint,acknowledged:true});
assert.equal(delivered.status,200,JSON.stringify(delivered.data));assert.equal(delivered.data.productId,product.id);
const archiveInput={...delivered.data,expectedRevision:delivered.data.revision,archived:true};
assert.equal((await call(patient,'/api/entries/'+planId,{...archiveInput,strength:75},'PUT')).status,403);
const archived=await call(patient,'/api/entries/'+planId,archiveInput,'PUT');assert.equal(archived.status,200,JSON.stringify(archived.data));assert.equal(archived.data.origin,'doctor');assert.equal(archived.data.archived,true);assert.equal(archived.data.history.length,1);
assert.equal((await call(patient,'/api/entries/'+planId,{...archived.data,expectedRevision:archived.data.revision,archived:false},'PUT')).status,403);
const manualId=randomUUID(),manual=await call(patient,'/api/entries/'+manualId,{...plan,id:manualId,productId:product.id,type:'medication-plan'},'PUT');assert.equal(manual.status,200,JSON.stringify(manual.data));
const doctorArchived=await call(doctor,'/api/care/patients/'+id+'/medications/'+manualId+'/archive',{expectedRevision:manual.data.revision});assert.equal(doctorArchived.status,200,JSON.stringify(doctorArchived.data));assert.equal(doctorArchived.data.lastChangedBy.type,'doctor');
await call(patient,'/api/care/links/'+id,{status:'revoked'});assert.equal((await call(doctor,'/api/care/patients/'+id+'/medical-profile',{...medical,expectedRevision:2})).status,403);
console.log(JSON.stringify({passed:true,syntheticOnly:true,checks:'separate role cookies in one cookie jar, persistent code, consent, two-step INN/product suggestions, ICD canonical labels, physician edit provenance/history, stale edit rejection, bilingual DDI and disease matches, actual registration without downloaded PDF checked by INN, delivered therapy, archive-only patient permission, clinician archive with history, revocation',interactions:report.data.interactions.length,diseaseMatches:report.data.diseaseInteractions.length}));
