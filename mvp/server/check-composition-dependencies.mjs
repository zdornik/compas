// Synthetic public reference rows only, always rolled back. No patient records.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolveIngredientMappings,providerPairs} from './ingredient-identities.mjs';
import {lockReferenceWrite} from './refresh-reference-catalog.mjs';
const pool=new pg.Pool({host:'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1}),db=await pool.connect(),suffix=randomUUID();
const a='qa-composition-a:'+suffix,b='qa-composition-b:'+suffix,root='qa-composition:'+suffix,names=['QA A '+suffix,'QA B '+suffix],evidence=JSON.stringify([{kind:'reviewed_component_chain',synthetic:true}]);
try{
 await db.query('BEGIN');await lockReferenceWrite(db);
 for(const [i,id] of [a,b].entries()){
  await db.query(`INSERT INTO knowledge.substances(id,name_ru,name_en,normalized_name,source_id,kind) VALUES($1,$2,$3,$2,'grls','substance')`,[id,names[i],'English '+i]);
  await db.query(`INSERT INTO knowledge.ingredient_entities(id,name_ru,name_en,chemical_form,review_status,evidence) VALUES($1,$2,$3,'synthetic','reviewed',$4)`,[id,names[i],'English '+i,evidence]);
  await db.query(`INSERT INTO knowledge.registry_compositions(substance_id,expected_components,review_status,evidence) VALUES($1,1,'reviewed',$2)`,[id,JSON.stringify([{synthetic:true}])]);
  await db.query(`INSERT INTO knowledge.registry_components(substance_id,ingredient_id,chemical_form,relation,review_status,evidence) VALUES($1,$1,'synthetic','exact','reviewed',$2)`,[id,evidence]);
  await db.query(`INSERT INTO knowledge.provider_ingredients(ingredient_id,provider,external_id,external_name,review_status,evidence) VALUES($1,'ddinter',$1,$1,'reviewed',$2)`,[id,evidence]);
 }
 await db.query(`INSERT INTO knowledge.substances(id,name_ru,normalized_name,source_id,kind) VALUES($1,$2,$2,'grls','substance')`,[root,names.join('+')]);
 let result=(await resolveIngredientMappings(db,[root]))[0];assert.equal(result.nameEn,'English 0 + English 1');assert.equal(result.status,'unmapped','Display translation must not grant a clinical mapping');
 await db.query(`INSERT INTO knowledge.registry_compositions(substance_id,expected_components,review_status,evidence) VALUES($1,2,'reviewed',$2)`,[root,evidence]);
 for(const id of [a,b]){
  await db.query(`INSERT INTO knowledge.registry_components(substance_id,ingredient_id,chemical_form,relation,review_status,evidence) VALUES($1,$2,'synthetic','exact','reviewed',$3)`,[root,id,evidence]);
  await db.query('INSERT INTO knowledge.composition_dependencies(combination_id,component_substance_id,ingredient_id,provider_id) VALUES($1,$2,$2,$2)',[root,id]);
 }
 result=(await resolveIngredientMappings(db,[root]))[0];assert.equal(result.status,'mapped');assert.equal(result.components.length,2);
 await db.query("UPDATE knowledge.registry_compositions SET review_status='candidate' WHERE substance_id=$1",[a]);
 const blocked=(await resolveIngredientMappings(db,[root]))[0];assert.equal(blocked.status,'unmapped');assert.equal(blocked.reason,'component_source_changed');assert.equal(blocked.nameEn,'English 0 + English 1');assert.equal(providerPairs([blocked,{status:'mapped',components:[{providerId:'other'}]}]).length,0);
 await db.query("UPDATE knowledge.registry_compositions SET review_status='reviewed' WHERE substance_id=$1",[a]);
 await db.query('DELETE FROM knowledge.composition_dependencies WHERE combination_id=$1',[root]);
 assert.equal((await resolveIngredientMappings(db,[root]))[0].status,'unmapped','Missing dependencies must block the composition');
 assert.equal((await db.query("SELECT has_table_privilege('compass_app','knowledge.composition_dependencies','UPDATE') can_write")).rows[0].can_write,false);
 await db.query('ROLLBACK');assert.equal((await db.query('SELECT count(*)::int n FROM knowledge.substances WHERE id=$1',[root])).rows[0].n,0);
 console.log(JSON.stringify({displayTranslationDoesNotGrantMapping:true,completeCompositionMapped:true,staleComponentBlocksWholeComposition:true,missingDependenciesBlocked:true,patientDataRead:false,patientDataWritten:false,syntheticRowsRolledBack:true}));
}finally{await db.query('ROLLBACK').catch(()=>{});db.release();await pool.end();}
