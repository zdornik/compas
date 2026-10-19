import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateIngredientMapping,providerPairs} from '../server/ingredient-identities.mjs';
const row={registryName:'Пример МНН',expectedComponents:1,compositionStatus:'reviewed',ingredientId:'test-ingredient',nameRu:'Пример',nameEn:'Synthetic ingredient',identityStatus:'reviewed',chemicalForm:'base',componentStatus:'reviewed',relation:'exact',providerStatus:'reviewed',externalId:'SYNTHETIC-DDI-1'};
test('a translated English label alone cannot enable DDI lookup',()=>{
 for(const patch of [{identityStatus:'candidate'},{compositionStatus:'candidate'},{componentStatus:'candidate'},{providerStatus:'candidate'},{relation:'unresolved'},{externalId:null}])assert.equal(evaluateIngredientMapping('inn:test',[{...row,...patch}]).status,'unmapped');
 assert.equal(evaluateIngredientMapping('inn:test',[row]).status,'mapped');
 assert.equal(evaluateIngredientMapping('inn:empty',[]).status,'unmapped');
});
test('every component of a combination and each salt/form relationship must be reviewed',()=>{
 const left={...row,expectedComponents:2},right={...row,expectedComponents:2,ingredientId:'test-ingredient-2',externalId:'SYNTHETIC-DDI-2',relation:'reviewed_active_moiety'};
 assert.equal(evaluateIngredientMapping('inn:combo',[left]).status,'unmapped');
 assert.equal(evaluateIngredientMapping('inn:combo',[left,right]).status,'mapped');
 assert.equal(evaluateIngredientMapping('inn:combo',[left,{...right,relation:'unresolved'}]).status,'unmapped');
 assert.equal(evaluateIngredientMapping('inn:ambiguous',[row,{...row,externalId:'SYNTHETIC-DDI-2'}]).status,'unmapped');
});
test('provider pairs expand components, deduplicate symmetric pairs and exclude unresolved identities',()=>{
 const groups=[{status:'mapped',components:[{providerId:'A'},{providerId:'B'}]},{status:'mapped',components:[{providerId:'C'}]},{status:'unmapped',components:[{providerId:'D'}]}];
 assert.deepEqual(providerPairs(groups),[{a:'A',b:'C'},{a:'B',b:'C'}]);
 assert.deepEqual(providerPairs([groups[0],groups[0]]),[{a:'A',b:'B'}]);
});
test('manual source conflicts override older links and descriptive names never enable a pair',()=>{
 for(const manualProviderStatus of ['source_conflict','composition_incomplete','absent_from_snapshot','form_unresolved']){
  const result=evaluateIngredientMapping('inn:review',[{...row,registryNameEn:'Display description',translationKind:'descriptive',manualProviderStatus,reviewNote:'Source review'}]);
  assert.equal(result.status,'unmapped');assert.equal(result.reason,manualProviderStatus);assert.equal(result.reviewNote,'Source review');
  assert.deepEqual(providerPairs([result,{status:'mapped',components:[{providerId:'OTHER'}]}]),[]);
 }
 assert.equal(evaluateIngredientMapping('inn:review',[{...row,manualProviderStatus:'linked'}]).status,'mapped');
});
