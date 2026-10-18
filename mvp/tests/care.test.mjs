import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeMedicalProfile} from '../src/medical-profile.js';
import {validateEntry} from '../server/validation.mjs';
import {instructionSafetySections,safetyExcerpt} from '../server/prescription-safety.mjs';
test('medical reconciliation has revisions, bounds and idempotent retries without trusting provenance',()=>{
 const input={id:'medical-profile',type:'medical-profile',expectedRevision:0,medications:[{id:'med-1',name:'  Тестовый препарат  ',details:'вымышленный',origin:'doctor'}],conditions:[{id:'condition-1',name:'Тестовый диагноз',details:''}]};
 const record=makeMedicalProfile(input,null,new Date('2026-10-18T12:00:00Z'));
 assert.equal(record.medications[0].name,'Тестовый препарат');assert.equal(record.revision,1);assert.equal(record.medications[0].origin,undefined);
 assert.deepEqual(makeMedicalProfile(input,record),record);
 assert.throws(()=>makeMedicalProfile({...input,conditions:[]},record),{status:409});
 assert.equal(makeMedicalProfile({...input,conditions:[],expectedRevision:1},record).revision,2);
 assert.throws(()=>makeMedicalProfile({...input,medications:Array(81).fill(input.medications[0])}));
 assert.throws(()=>makeMedicalProfile({...input,medications:[{...input.medications[0],name:''}]}));
 assert.throws(()=>makeMedicalProfile({...input,conditions:[{id:'med-1',name:'duplicate'}]}));
});
test('patients cannot alter a physician-issued medication plan or forge one through manual entry',()=>{
 assert.throws(()=>validateEntry({id:'plan-1',type:'medication-plan'},'plan-1',{type:'medication-plan',origin:'doctor'}),{status:403});
});
test('instruction screening keeps safety section boundaries, page provenance and negative statements',()=>{
 const sections=instructionSafetySections([{page:1,text:'Показания к применению\nпример\nПРОТИВОПОКАЗАНИЯ\nДиагноз А.\nС осторожностью\nПри диагнозе Б.\nСпособ применения и дозы\nНе искать здесь.'},{page:2,text:'Взаимодействие с другими лекарственными средствами\nНе выявлено влияния препарата В.\nПобочное действие\nНе искать здесь.'}]);
 assert.equal(sections.length,3);assert.equal(sections[0].kind,'Противопоказания');assert.match(sections[2].text,/Не выявлено/);assert.equal(sections[2].page,2);assert.ok(sections.every(row=>!row.text.includes('Не искать здесь')));
});

test('evidence excerpts retain a whole source bullet, including negation and the leading clause',()=>{
 const text='Противопоказания\n• Другое условие.\n• Если Вы НЕ принимаете __COMPASS_HIT__препарат А__COMPASS_HIT__, исключение отсутствует.\n• Другое условие.';
 const excerpt=safetyExcerpt(text);assert.match(excerpt,/Если Вы НЕ принимаете препарат А/);assert.doesNotMatch(excerpt,/COMPASS/);assert.doesNotMatch(excerpt,/Другое условие/);
});

test('medical reconciliation retains canonical ICD codes, author and prior contents across physician edits',()=>{
 const first=makeMedicalProfile({id:'medical-profile',type:'medical-profile',expectedRevision:0,medications:[],conditions:[{id:'epilepsy',name:'Эпилепсия',icd10:'G40',details:''}]},null,new Date('2026-10-18T10:00:00Z'));
 const draft={id:'medical-profile',type:'medical-profile',expectedRevision:1,medications:[],conditions:[{id:'epilepsy',name:'Эпилепсия',icd10:'G40',details:'Уточнено по выписке'}]};
 const changed=makeMedicalProfile(draft,first,new Date('2026-10-18T11:00:00Z'),{type:'doctor',name:'Тестовый врач'});
 assert.equal(changed.conditions[0].icd10,'G40');assert.equal(changed.conditions[0].source.type,'doctor');assert.equal(changed.updatedBy.name,'Тестовый врач');assert.equal(changed.history[0].conditions[0].details,'');assert.equal(changed.history[0].conditions[0].source.type,'patient');
 assert.throws(()=>makeMedicalProfile({...draft,conditions:[]},changed),/другом окне/);
 assert.deepEqual(makeMedicalProfile({...draft,expectedRevision:0},changed),changed);
});
