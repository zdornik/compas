import {lockReferenceWrite,refreshReferenceCatalog} from './refresh-reference-catalog.mjs';
// Public nomenclature and strictly verified identities; no patient reads/writes.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildNsiCrosswalk} from './nsi-crosswalk.mjs';
const read=async path=>JSON.parse(await readFile('knowledge/'+path)),hash=value=>createHash('sha256').update(value).digest('hex');
const m=await read('nsi-drug-terms-manifest.json'),raw=await readFile('knowledge/'+m.preparedFile),terms=JSON.parse(raw),catalog=await read('nsi-provider-crosswalk.json'),providerBytes=await readFile('knowledge/raw/openmrs/kb.json'),substanceBytes=await readFile('knowledge/processed/grls-substances.json');
if(hash(raw)!==m.preparedSha256||m.preparedSha256!==catalog.nsi.sha256||hash(await readFile('knowledge/raw/nsi/'+m.archiveName))!==m.archiveSha256||hash(providerBytes)!==catalog.providerSha256||hash(substanceBytes)!==catalog.grlsSha256||terms.length!==m.records||new Set(terms.map(t=>t.code)).size!==m.records)throw new Error('NSI snapshot mismatch');
const previous=await read('eaeu-provider-crosswalk.json'),manual=await read('manual-ingredient-review.json'),reviewed=await read('ingredient-source-links.json'),result=buildNsiCrosswalk(JSON.parse(substanceBytes),terms,JSON.parse(providerBytes).drugs,[...reviewed,...previous.links,...manual.reviews],await read('processed/eaeu-inn.json'));
if(JSON.stringify(result.links)!==JSON.stringify(catalog.links))throw new Error('NSI provider decisions changed');
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1}),db=await pool.connect();let added=0;
try{
 await db.query('BEGIN');await lockReferenceWrite(db);await db.query('SELECT pg_advisory_xact_lock(2026101909)');
 await db.query(`INSERT INTO knowledge.nsi_drug_snapshots(id,oid,version,manifest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[m.archiveSha256,m.oid,m.version,m]);
 for(let i=0;i<terms.length;i+=1500)await db.query(`INSERT INTO knowledge.nsi_drug_terms SELECT $1,x.code,$2,x.name_ru,x.name_en,x.name_la,x.name_la_genitive,x.alternatives,x."group",x.inn_rf,x.atc,x.sctid,x."sourceRow" FROM jsonb_to_recordset($3::jsonb) AS x(code text,name_ru text,name_en text,name_la text,name_la_genitive text,alternatives text[],"group" text,inn_rf text,atc text[],sctid text,"sourceRow" int) ON CONFLICT DO NOTHING`,[m.archiveSha256,m.version,JSON.stringify(terms.slice(i,i+1500))]);
 await db.query('DELETE FROM knowledge.nsi_substance_terms WHERE snapshot_id=$1',[m.archiveSha256]);
 await db.query(`INSERT INTO knowledge.nsi_substance_terms WITH names AS (SELECT snapshot_id,code,knowledge.esklp_name_key(name_ru) name_key,'exact_primary' relation,0 priority FROM knowledge.nsi_drug_terms WHERE snapshot_id=$1 UNION ALL SELECT snapshot_id,code,knowledge.esklp_name_key(a),'source_alternative',1 FROM knowledge.nsi_drug_terms CROSS JOIN LATERAL unnest(alternatives) a WHERE snapshot_id=$1) SELECT DISTINCT ON(s.id,n.snapshot_id,n.code) s.id,n.snapshot_id,n.code,n.relation FROM knowledge.substances s JOIN names n ON knowledge.esklp_name_key(s.name_ru)=n.name_key ORDER BY s.id,n.snapshot_id,n.code,n.priority`,[m.archiveSha256]);
 const naming=await db.query(`UPDATE knowledge.substances s SET name_en=q.name_en FROM (SELECT l.substance_id,min(t.name_en) name_en FROM knowledge.nsi_substance_terms l JOIN knowledge.nsi_drug_terms t ON t.snapshot_id=l.snapshot_id AND t.code=l.term_code WHERE l.snapshot_id=$1 AND t.name_en IS NOT NULL GROUP BY l.substance_id HAVING count(DISTINCT knowledge.esklp_name_key(t.name_en))=1) q WHERE s.id=q.substance_id AND s.name_en IS NULL`,[m.archiveSha256]);
 for(const row of catalog.links){
  const original=(await db.query('SELECT name_ru FROM knowledge.substances WHERE id=$1',[row.substanceId])).rows[0];if(original?.name_ru!==row.nameRu)throw new Error('GRLS identity changed');
  if((await db.query('SELECT 1 FROM knowledge.registry_compositions WHERE substance_id=$1',[row.substanceId])).rows.length)continue;
  const id='inn:'+row.nameEn,evidence=JSON.stringify([{kind:catalog.method,nsi:catalog.nsi,nsiCodes:row.nsiCodes,providerId:row.providerId,rxnormName:row.rxnormName,rxcui:row.rxcui,providerSha256:catalog.providerSha256,clinicalUseApproved:false}]);
  await db.query("INSERT INTO knowledge.ingredient_entities(id,name_ru,name_en,chemical_form,review_status,evidence) VALUES($1,$2,$3,'source_defined_inn','reviewed',$4) ON CONFLICT DO NOTHING",[id,row.nameRu,row.nameEn,evidence]);
  await db.query("INSERT INTO knowledge.registry_compositions(substance_id,expected_components,review_status,evidence) VALUES($1,1,'reviewed',$2)",[row.substanceId,evidence]);
  await db.query("INSERT INTO knowledge.registry_components(substance_id,ingredient_id,chemical_form,relation,review_status,evidence) VALUES($1,$2,'source_defined_inn','exact','reviewed',$3)",[row.substanceId,id,evidence]);
  await db.query("INSERT INTO knowledge.provider_ingredients(ingredient_id,provider,external_id,external_name,review_status,evidence) VALUES($1,'ddinter',$2,$3,'reviewed',$4) ON CONFLICT DO NOTHING",[id,row.providerId,row.providerName,evidence]);
  await db.query("UPDATE knowledge.substances SET mapping_status='source_verified' WHERE id=$1",[row.substanceId]);added++;
 }
 await db.query('UPDATE knowledge.nsi_drug_snapshots SET active=false WHERE active');await db.query('UPDATE knowledge.nsi_drug_snapshots SET active=true WHERE id=$1',[m.archiveSha256]);
 await db.query(`INSERT INTO knowledge.sources(id,name,url,license,coverage,metadata,retrieved_at) VALUES('nsi-drug-ingredients','Действующие вещества · НСИ Минздрава',$1,'Официальная пользовательская выгрузка; исходные идентификаторы и атрибуция сохранены.','Русские, английские и латинские имена; явные синонимы, АТХ и SNOMED. Соответствие DDI проверяется отдельно.',$2,now()) ON CONFLICT(id) DO UPDATE SET metadata=EXCLUDED.metadata,retrieved_at=now()`,[m.sourceUrl,JSON.stringify({...m,addedExactProviderIdentities:added})]);
 await refreshReferenceCatalog(db);await db.query('COMMIT');console.log(JSON.stringify({terms:terms.length,version:m.version,englishNames:m.englishNames,latinNames:m.latinNames,registryEnglishNamesAdded:naming.rowCount,providerIdentitiesAdded:added,patientDataRead:false,patientDataWritten:false}));
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
