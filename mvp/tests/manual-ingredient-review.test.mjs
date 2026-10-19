import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const catalog=JSON.parse(await readFile(new URL('../knowledge/manual-ingredient-review.json',import.meta.url)));
const byName=name=>catalog.reviews.find(row=>row.nameRu===name);
test('remaining psychiatry names retain complete manual decisions and source evidence',()=>{
 assert.equal(catalog.reviews.length,67);assert.equal(new Set(catalog.reviews.map(row=>row.substanceId)).size,67);
 assert.equal(catalog.clinicalUseApproved,false);
 const linked=catalog.reviews.filter(row=>row.providerStatus==='linked');assert.equal(linked.length,8);
 for(const row of catalog.reviews){assert.ok(row.nameEn);assert.ok(row.note);if(row.providerStatus!=='linked')assert.deepEqual(row.components,[]);}
 for(const row of linked){assert.ok(row.evidence.some(item=>item.kind==='grls_full_composition'&&item.documentId&&item.sha256));assert.ok(row.components.every(part=>part.providerId&&part.providerName&&['exact','reviewed_active_moiety'].includes(part.relation)));}
 assert.deepEqual(byName('Донепезил+Мемантин').components.map(part=>part.providerId),['DDInter583','DDInter1146']);
 assert.deepEqual(byName('Дифенгидрамин+Мелатонин').components.map(part=>part.providerId),['DDInter569','DDInter1142']);
 assert.equal(byName('Левомепромазин').components[0].providerName,'Methotrimeprazine');
});
test('conflicting identities, missing ingredients and herbal forms are not replaced by related drugs',()=>{
 assert.equal(byName('Галантамин').providerStatus,'source_conflict');
 assert.equal(byName('Аминофенилмасляная кислота').providerStatus,'absent_from_snapshot');
 assert.equal(byName('Глицин+Мелатонин').providerStatus,'composition_incomplete');
 assert.equal(byName('Валерианы лекарственной корневищ с корнями настойка').providerStatus,'form_unresolved');
 assert.equal(byName('Валерианы лекарственной корневищ с корнями экстракт').translationKind,'descriptive');
});
