import test from 'node:test';
import assert from 'node:assert/strict';
import {compositionNames,findCompositionDeclaration,applyCompositionDependencies} from '../server/composition-crosswalk.mjs';
import {evaluateIngredientMapping} from '../server/ingredient-identities.mjs';
test('explicit composition retains full salt names and rejects alternatives or duplicate components',()=>{
 assert.deepEqual(compositionNames('Валсартан + Розувастатин'),['Валсартан','Розувастатин']);
 assert.deepEqual(compositionNames('Вещество гидрохлорид+Другое вещество'),['Вещество гидрохлорид','Другое вещество']);
 for(const name of ['Вещество','A/B+C','A+[B/C]','A (B)+C','A+','A+A'])assert.equal(compositionNames(name),null);
});
test('only a complete source naming declaration establishes a composition',()=>{
 const name='Валсартан+Розувастатин';
 assert.equal(findCompositionDeclaration([{page:1,text:'Действующие вещества: валсартан + розувастатин\nПеред приёмом…'}],name)?.page,1);
 assert.equal(findCompositionDeclaration([{page:2,text:'Международное непатентованное или группировочное наименование:\nвалсартан +\nрозувастатин\nЛекарственная форма'}],name)?.page,2);
 for(const text of ['Другие лекарства: валсартан + розувастатин','Действующие вещества: валсартан','Действующие вещества: валсартан + розувастатин + амлодипин','Действующие вещества: валсартан + розувастатин кальция'])assert.equal(findCompositionDeclaration([{page:1,text}],name),null);
});
const leaves=new Map(['A','B'].map(id=>[id,{status:'mapped',expectedComponents:1,components:[{ingredientId:id,providerId:'source-'+id}]}]));
const deps=['A','B'].map(id=>({substanceId:id,ingredientId:id,providerId:'source-'+id})),mapping={status:'mapped',expectedComponents:2,requiresComponentDependencies:true,components:deps};
test('a composition stops matching when a source component becomes incomplete, conflicting or ambiguous',()=>{
 assert.equal(applyCompositionDependencies(mapping,deps,leaves).status,'mapped');
 for(const status of ['unmapped','candidate'])assert.equal(applyCompositionDependencies(mapping,deps,new Map([...leaves,['A',{...leaves.get('A'),status}]] )).status,'unmapped');
 assert.equal(applyCompositionDependencies(mapping,[],leaves).status,'unmapped');
 assert.equal(applyCompositionDependencies(mapping,[deps[0]],leaves).status,'unmapped');
 assert.equal(applyCompositionDependencies(mapping,[deps[0],{...deps[1],providerId:'other'}],leaves).status,'unmapped');
 const changedForm=new Map([...leaves,['A',{...leaves.get('A'),components:[{...leaves.get('A').components[0],relation:'unresolved'}]}]]);
 assert.equal(applyCompositionDependencies(mapping,deps,changedForm).status,'unmapped');
 assert.equal(applyCompositionDependencies({...mapping,status:'unmapped',reason:'source_conflict'},[],leaves).reason,'source_conflict');
});
test('a partial composition cannot display only its first component as the full English name',()=>{
 const result=evaluateIngredientMapping('combo',[{registryName:'A+B',expectedComponents:2,compositionStatus:'candidate',ingredientId:'A',nameRu:'A',nameEn:'English A'}]);
 assert.equal(result.nameEn,null);assert.equal(result.status,'unmapped');
});
