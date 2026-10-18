import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentMedicationRows} from '../src/current-medications.js';
import {makeMedicationPlan,medicationDraft,medicationSchedule} from '../src/medications.js';
import {validateEntry} from '../server/validation.mjs';
import {smallestProductStrength,applyProductSelection} from '../src/product-dose.js';
import {normalizeReferenceText,sourceSentenceForHit} from '../src/reference-text.js';
const id='b3cc2346-f96a-48d7-a450-cf3a23634f62',productId='grls:'+'a'.repeat(64),now=new Date('2026-10-18T08:00:00Z');
const input={...medicationDraft(),id,name:'Тест',productId,strength:25,quantity:1,startDate:'2026-10-18',times:['12:00']};
test('patient archives a physician plan without changing dose, source, history or recorded intake',()=>{
 const plan={...makeMedicationPlan(input,id,null,now),origin:'doctor',prescriberName:'Синтетический врач',instructionDocumentId:'test-source',safetyReview:{fingerprint:'source'}};
 const archived=validateEntry({...medicationDraft(plan),type:'medication-plan',archived:true},id,plan,now);
 assert.equal(archived.archived,true);assert.equal(archived.origin,'doctor');assert.equal(archived.prescriberName,plan.prescriberName);assert.deepEqual(archived.safetyReview,plan.safetyReview);assert.equal(archived.history.length,1);assert.equal(archived.history[0].strength,25);assert.equal(archived.lastChangedBy.type,'patient');
 assert.throws(()=>validateEntry({...medicationDraft(plan),type:'medication-plan',archived:true,strength:50},id,plan,now),{status:403});
 assert.throws(()=>validateEntry({...medicationDraft(archived),type:'medication-plan',archived:false},id,archived,now),{status:403});
 assert.equal(validateEntry({...medicationDraft(archived),type:'medication-plan',archived:true},id,archived,now),archived);
 const mark={id:'recorded',type:'medication-dose',planId:id,day:'2026-10-18',status:'taken',revision:1,snapshot:{planId:id,day:'2026-10-18',time:'12:00',strength:25,quantity:1}};
 assert.ok(medicationSchedule([archived,mark],'2026-10-18').some(row=>row.status==='taken'&&row.strength===25));
});
test('current list includes future prescriptions and self-reported drugs, excluding archived/ended plans',()=>{
 const plan=makeMedicationPlan(input,id,null,now),future={...plan,id:'future',startDate:'2026-10-25'},archived={...plan,id:'old',archived:true},ended={...plan,id:'ended',endDate:'2026-10-17'};
 const rows=currentMedicationRows([plan,future,archived,ended],{medications:[{id:'manual',name:'Другой препарат'}]},'2026-10-18');
 assert.equal(rows.length,3);assert.ok(rows.some(row=>row.planId==='future'));assert.ok(rows.some(row=>row.id==='manual'));assert.ok(!rows.some(row=>['old','ended'].includes(row.planId)));
});
test('registered strength parser chooses the smallest solid strength while rejecting ambiguous combinations/liquids',()=>{
 assert.deepEqual(smallestProductStrength({form:'таблетки, покрытые оболочкой, 100 мг, 10 шт. - упаковки; таблетки, 25 мг, 30 шт. - упаковки;'}),{form:'tablet',strength:25,unit:'мг',quantity:1});
 assert.equal(smallestProductStrength({form:'капсулы, 0,1 г; капсулы, 50 мг'}).strength,50);
 for(const form of ['раствор, 10 мг/мл','таблетки, 10 мг + 5 мг','таблетки, 10 мг/5 мг','таблетки, 5%','таблетки, 5 мг; капсулы, 10 мг','таблетки без дозировки'])assert.equal(smallestProductStrength({form}),null);
 const patch={productId,product:{form:'таблетки, 25 мг'}},draft=medicationDraft();assert.equal(applyProductSelection(draft,patch).quantity,1);
 assert.equal(applyProductSelection({...draft,productId,strength:50,quantity:2},patch).strength,50);
 const titration={...draft,titration:{enabled:true,stages:[{strength:10,quantity:1}]}};assert.deepEqual(applyProductSelection(titration,patch).titration,titration.titration);
});
test('compact source sentence preserves negation and condition, glyph cleanup preserves character offsets',()=>{
 const text=' Другое условие. Не выявлено влияния при __COMPASS_HIT__эпилепсии__COMPASS_HIT__. Следующий абзац.';
 assert.equal(normalizeReferenceText(text).length,text.length);assert.equal(normalizeReferenceText(text)[0],'•');
 assert.equal(sourceSentenceForHit(text),'Не выявлено влияния при эпилепсии.');
});
