import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInnCrosswalk} from '../server/ingredient-crosswalk.mjs';
const substances=[{id:'a',nameRu:'Метионин'}],terms=[{code:'000001',name_ru:'метионин',name_en:'methionine'}],drugs=[{id:'DDInter1',name:'Methionine',rxcui:'1',rxnorm_name:'methionine'}];
test('official exact bilingual INN resolves to original provider ID without needing an instruction',()=>{
 const result=buildInnCrosswalk(substances,terms,drugs);assert.equal(result.links[0].providerId,'DDInter1');assert.equal(result.links[0].relation,'exact');assert.equal(result.gaps.length,0);
});
test('canonical conflicts, salts, ambiguous providers, translations and combinations cannot become mappings',()=>{
 for(const [ss,ts,ds,reason] of [
 [substances,terms,[{...drugs[0],rxnorm_name:'N-acetylmethionine'}],'provider_canonical_identity_disagrees'],
 [substances,terms,[{...drugs[0],name:'Methionine hydrochloride'}],'provider_ingredient_missing'],
 [substances,terms,[...drugs,{...drugs[0],id:'DDInter2'}],'provider_id_ambiguous'],
 [substances,[...terms,{code:'000002',name_ru:'метионин',name_en:'other'}],drugs,'official_translation_ambiguous'],
 [[{id:'b',nameRu:'Метионин+Другое'}],terms,drugs,'composition_requires_component_review'],
 [substances,terms,[{...drugs[0],rxcui:null}],'provider_canonical_identity_disagrees']]){
  const result=buildInnCrosswalk(ss,ts,ds);assert.equal(result.links.length,0);assert.equal(result.gaps[0].reason,reason);
 }
});
