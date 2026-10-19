import assert from 'node:assert/strict';
import {providerPairs} from '../server/ingredient-identities.mjs';
const origin=process.env.COMPASS_TEST_ORIGIN||'http://127.0.0.1:4174',get=async path=>{const r=await fetch(origin+'/api/knowledge/'+path,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,path);return r.json();};
const products=[];
for(const name of ['Гидроксизин','Сертралин','Валсартан+Розувастатин']){
 const list=await get('products?allStatuses=1&limit=100&q='+encodeURIComponent(name)),p=list.items.find(x=>x.inn===name);assert.ok(p);products.push(p);
}
const pair=await get('interactions?'+products.map(p=>'id='+p.id).join('&')),combo=pair.identityMappings.find(m=>m.nameRu==='Валсартан+Розувастатин');
assert.equal(pair.identityMappings.filter(m=>m.status==='mapped').length,3);assert.notEqual(pair.status,'unmapped');assert.equal(pair.safeToCombine,null);
assert.equal(combo.nameEn,'valsartan + rosuvastatin');assert.equal(combo.expectedComponents,2);assert.deepEqual(combo.components.map(c=>c.providerId).sort(),['DDInter1622','DDInter1915']);assert.ok(combo.reviewSources.some(s=>s.kind==='grls_full_composition'));
assert.equal(providerPairs(pair.identityMappings).length,5,'Each combination component must be checked against the other selected medicines');
const gal=(await get('products?allStatuses=1&limit=100&q='+encodeURIComponent('Галантамин'))).items.find(x=>x.inn==='Галантамин'),blocked=(await get('products/'+gal.id)).identityMappings[0];assert.equal(blocked.status,'unmapped');assert.equal(blocked.reason,'source_conflict');
console.log(JSON.stringify({screenshotScenarioMapped:true,combinationEnglish:combo.nameEn,componentIds:combo.components.map(c=>c.providerId),crossProductPairs:5,sourceRecords:pair.items.length,manualConflictStillBlocked:true,safeToCombine:null,patientDataRead:false,patientDataWritten:false}));
