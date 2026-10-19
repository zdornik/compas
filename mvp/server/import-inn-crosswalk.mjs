// Offline, public knowledge only. Recompute every match before accepting the artifact.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildInnCrosswalk} from './ingredient-crosswalk.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex'),read=async path=>JSON.parse(await readFile('knowledge/'+path,'utf8'));
const catalog=await read('eaeu-provider-crosswalk.json'),termsBytes=await readFile('knowledge/processed/eaeu-inn.json'),providerBytes=await readFile('knowledge/raw/openmrs/kb.json'),substanceBytes=await readFile('knowledge/processed/grls-substances.json');
if(hash(termsBytes)!==catalog.sources.eaeu.sha256||hash(providerBytes)!==catalog.sources.provider.sha256||hash(substanceBytes)!==catalog.sources.grls.substancesSha256)throw new Error('Crosswalk source checksum mismatch');
const result=buildInnCrosswalk(JSON.parse(substanceBytes),JSON.parse(termsBytes),JSON.parse(providerBytes).drugs,await read('ingredient-source-links.json'));
if(JSON.stringify(result.links)!==JSON.stringify(catalog.links))throw new Error('Crosswalk differs from exact verified source chain');
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1}),db=await pool.connect();let imported=0,skipped=0;
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(2026101903)');
 for(const row of catalog.links){
  const original=(await db.query('SELECT name_ru FROM knowledge.substances WHERE id=$1',[row.substanceId])).rows[0];if(original?.name_ru!==row.nameRu)throw new Error('GRLS identity changed');
  const previous=(await db.query('SELECT review_status FROM knowledge.registry_compositions WHERE substance_id=$1',[row.substanceId])).rows[0];
  if(previous){skipped++;continue;}
  const evidence=JSON.stringify([{kind:catalog.method,nameRu:row.nameRu,nameEn:row.nameEn,eaeuCodes:row.termCodes,providerId:row.providerId,rxcui:row.rxcui,rxnormName:row.rxnormName,sources:catalog.sources,identityOnly:true,clinicalUseApproved:false}]);
  const id='inn:'+row.nameEn;
  await db.query("INSERT INTO knowledge.ingredient_entities(id,name_ru,name_en,chemical_form,review_status,evidence) VALUES($1,$2,$3,'source_defined_inn','reviewed',$4) ON CONFLICT(id) DO NOTHING",[id,row.nameRu,row.nameEn,evidence]);
  const entity=(await db.query('SELECT name_en FROM knowledge.ingredient_entities WHERE id=$1',[id])).rows[0];if(entity.name_en!==row.nameEn)throw new Error('Ingredient identity collision');
  await db.query("INSERT INTO knowledge.registry_compositions(substance_id,expected_components,review_status,evidence) VALUES($1,1,'reviewed',$2)",[row.substanceId,evidence]);
  await db.query("INSERT INTO knowledge.registry_components(substance_id,ingredient_id,chemical_form,relation,review_status,evidence) VALUES($1,$2,'source_defined_inn','exact','reviewed',$3)",[row.substanceId,id,evidence]);
  await db.query("INSERT INTO knowledge.provider_ingredients(ingredient_id,provider,external_id,external_name,review_status,evidence) VALUES($1,'ddinter',$2,$3,'reviewed',$4) ON CONFLICT DO NOTHING",[id,row.providerId,row.providerName,evidence]);
  await db.query("UPDATE knowledge.substances SET name_en=$2,mapping_status='source_verified' WHERE id=$1",[row.substanceId,row.nameEn]);imported++;
 }
 await db.query(`INSERT INTO knowledge.sources(id,name,url,license,coverage,metadata,retrieved_at) VALUES('eaeu-identity-crosswalk','МНН ЕАЭС → DDInter / RxNorm',$1,'Условия исходных ЕАЭС и OpenMRS/DDInter сохраняются.','Точное одно-компонентное МНН, однозначное имя провайдера и такое же каноническое имя RxNorm; без подмены солей и без зависимости от PDF.',$2,now()) ON CONFLICT(id) DO UPDATE SET metadata=EXCLUDED.metadata,retrieved_at=now()`,[catalog.sources.eaeu.url,JSON.stringify({identityCoverage:catalog.counts,sources:catalog.sources,method:catalog.method,clinicalUseApproved:false})]);
 await db.query('COMMIT');console.log(JSON.stringify({imported,skippedExisting:skipped,identityCoverage:catalog.counts,clinicalUseApproved:false}));
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
