import {resolveIngredientMappings} from './ingredient-identities.mjs';
import {identityName} from './ingredient-crosswalk.mjs';
import {compositionNames,findCompositionDeclaration} from './composition-crosswalk.mjs';
// Offline publication only, within the caller's reference write transaction/lock.
// New compositions reuse existing reviewed single-ingredient identities. Neither
// a translated name nor a plus sign alone can grant a provider mapping.
export async function refreshReviewedCompositions(db){
 const candidates=(await db.query(`SELECT s.id,s.name_ru AS name FROM knowledge.substances s LEFT JOIN knowledge.registry_compositions c ON c.substance_id=s.id LEFT JOIN knowledge.manual_ingredient_reviews m ON m.substance_id=s.id WHERE s.source_id='grls' AND position('+' in s.name_ru)>0 AND c.substance_id IS NULL AND m.substance_id IS NULL ORDER BY s.id`)).rows.filter(s=>compositionNames(s.name));
 if(!candidates.length)return {added:0,names:[]};
 const names=[...new Set(candidates.flatMap(s=>compositionNames(s.name)).map(identityName))];
 const substances=(await db.query("SELECT id,name_ru AS name FROM knowledge.substances WHERE source_id='grls' AND lower(regexp_replace(trim(name_ru),'\\s+',' ','g'))=ANY($1::text[])",[names])).rows;
 const mappings=await resolveIngredientMappings(db,substances.map(s=>s.id)),byId=new Map(mappings.map(m=>[m.substanceId,m]));
 const pages=(await db.query(`SELECT DISTINCT p.substance_id AS "substanceId",d.id,d.sha256,d.source_url AS url,k.page,k.text_content AS text FROM knowledge.products p JOIN knowledge.product_documents l ON l.product_id=p.id JOIN knowledge.documents d ON d.id=l.document_id JOIN knowledge.pages k ON k.document_id=d.id AND k.page<=2 WHERE p.substance_id=ANY($1::text[]) AND d.source_id='grls' AND d.mime_type='application/pdf' AND (d.source_url LIKE 'https://grls.minzdrav.gov.ru/%' OR d.source_url LIKE 'https://grls.rosminzdrav.ru/%') ORDER BY p.substance_id,d.id,k.page`,[candidates.map(s=>s.id)])).rows;
 const added=[];
 for(const candidate of candidates){
  const parts=compositionNames(candidate.name),leaves=parts.map(name=>{const found=substances.filter(s=>identityName(s.name)===identityName(name));return found.length===1?byId.get(found[0].id):null;});
  if(leaves.some(m=>m?.status!=='mapped'||m.expectedComponents!==1||m.components.length!==1||m.requiresComponentDependencies))continue;
  if(new Set(leaves.map(m=>m.components[0].ingredientId)).size!==parts.length||new Set(leaves.map(m=>m.components[0].providerId)).size!==parts.length)continue;
  const docs=new Map();for(const page of pages.filter(p=>p.substanceId===candidate.id)){if(!docs.has(page.id))docs.set(page.id,[]);docs.get(page.id).push(page);}
  let source;
  for(const document of docs.values()){const declaration=findCompositionDeclaration(document,candidate.name);if(declaration){source={kind:'grls_full_composition',documentId:document[0].id,sha256:document[0].sha256,url:document[0].url,...declaration};break;}}
  if(!source)continue;
  const dependencies=leaves.map(m=>({substanceId:m.substanceId,ingredientId:m.components[0].ingredientId,providerId:m.components[0].providerId}));
  const evidence=JSON.stringify([source,{kind:'reviewed_component_chain',components:dependencies,identityOnly:true,clinicalUseApproved:false}]);
  await db.query("INSERT INTO knowledge.registry_compositions(substance_id,expected_components,review_status,evidence) VALUES($1,$2,'reviewed',$3)",[candidate.id,parts.length,evidence]);
  for(const leaf of leaves){
   const c=leaf.components[0];
   await db.query(`INSERT INTO knowledge.registry_components(substance_id,ingredient_id,chemical_form,relation,review_status,evidence) SELECT $1,ingredient_id,chemical_form,relation,'reviewed',$3::jsonb FROM knowledge.registry_components WHERE substance_id=$2 AND ingredient_id=$4 AND review_status='reviewed'`,[candidate.id,leaf.substanceId,evidence,c.ingredientId]);
   await db.query('INSERT INTO knowledge.composition_dependencies(combination_id,component_substance_id,ingredient_id,provider_id) VALUES($1,$2,$3,$4)',[candidate.id,leaf.substanceId,c.ingredientId,c.providerId]);
  }
  await db.query("UPDATE knowledge.substances SET name_en=coalesce(name_en,$2),mapping_status='source_verified' WHERE id=$1",[candidate.id,leaves.map(m=>m.nameEn).join(' + ')]);
  added.push(candidate.name);
 }
 return {added:added.length,names:added};
}
