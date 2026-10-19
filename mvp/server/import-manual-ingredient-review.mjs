import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const raw=await readFile('knowledge/manual-ingredient-review.json'),catalog=JSON.parse(raw),manifest=JSON.parse(await readFile('knowledge/openmrs-manifest.json')),sourceBytes=await readFile('knowledge/raw/openmrs/kb.json'),kb=JSON.parse(sourceBytes),sourceDrugs=new Map(kb.drugs.map(row=>[row.id,row]));
if(hash(sourceBytes)!==catalog.sourceSnapshotSha256||catalog.sourceSnapshotSha256!==manifest.sha256||catalog.reviews.length!==67||new Set(catalog.reviews.map(row=>row.substanceId)).size!==67)throw new Error('Manual review snapshot mismatch');
for(const row of catalog.reviews){
 if(row.providerStatus==='linked'&&(!row.components.length||!row.evidence.some(e=>e.kind==='grls_full_composition')))throw new Error('Missing complete composition evidence');
 if(row.providerStatus!=='linked'&&row.components.length)throw new Error('Unresolved composition cannot acquire provider links');
 if(new Set(row.components.map(part=>part.providerId)).size!==row.components.length)throw new Error('Duplicate component identity');
 for(const component of row.components){const drug=sourceDrugs.get(component.providerId);if(!drug||drug.name!==component.providerName||!['exact','reviewed_active_moiety'].includes(component.relation))throw new Error('Manual provider reference mismatch');}
 for(const evidence of row.evidence)if(evidence.file&&hash(await readFile('knowledge/raw/manual/'+evidence.file))!==evidence.sha256)throw new Error('Manual primary source checksum mismatch');
}
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1}),db=await pool.connect();let added=0;
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(2026101905)');
 for(const row of catalog.reviews){
  const stored=(await db.query('SELECT name_ru FROM knowledge.substances WHERE id=$1',[row.substanceId])).rows[0];if(stored?.name_ru!==row.nameRu)throw new Error('Registry source changed');
  for(const e of row.evidence)if(e.documentId){const original=(await db.query('SELECT sha256 FROM knowledge.documents WHERE id=$1',[e.documentId])).rows[0];if(original?.sha256!==e.sha256)throw new Error('GRLS composition checksum mismatch');}
  await db.query(`INSERT INTO knowledge.manual_ingredient_reviews(substance_id,name_en,translation_kind,provider_status,components,evidence,note,snapshot_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(substance_id) DO UPDATE SET name_en=EXCLUDED.name_en,translation_kind=EXCLUDED.translation_kind,provider_status=EXCLUDED.provider_status,components=EXCLUDED.components,evidence=EXCLUDED.evidence,note=EXCLUDED.note,snapshot_sha256=EXCLUDED.snapshot_sha256,reviewed_at=now()`,[row.substanceId,row.nameEn,row.translationKind,row.providerStatus,JSON.stringify(row.components),JSON.stringify(row.evidence),row.note,hash(raw)]);
  if(row.nameEn)await db.query('UPDATE knowledge.substances SET name_en=coalesce(name_en,$2) WHERE id=$1',[row.substanceId,row.nameEn]);
  if(row.providerStatus!=='linked')continue;
  const previous=(await db.query('SELECT review_status FROM knowledge.registry_compositions WHERE substance_id=$1',[row.substanceId])).rows[0];if(previous)continue;
  const evidence=JSON.stringify(row.evidence);
  await db.query("INSERT INTO knowledge.registry_compositions(substance_id,expected_components,review_status,evidence) VALUES($1,$2,'reviewed',$3)",[row.substanceId,row.components.length,evidence]);
  for(const component of row.components){
   const known=(await db.query("SELECT DISTINCT ingredient_id FROM knowledge.provider_ingredients WHERE provider='ddinter' AND external_id=$1 AND review_status='reviewed'",[component.providerId])).rows;if(known.length>1)throw new Error('Ambiguous existing provider identity');
   const id=known[0]?.ingredient_id||'manual:'+component.providerId;
   await db.query("INSERT INTO knowledge.ingredient_entities(id,name_ru,name_en,chemical_form,review_status,evidence) VALUES($1,$2,$3,'manual_source_identity','reviewed',$4) ON CONFLICT(id) DO NOTHING",[id,component.nameRu,component.nameEn,evidence]);
   await db.query("INSERT INTO knowledge.registry_components(substance_id,ingredient_id,chemical_form,relation,review_status,evidence) VALUES($1,$2,'manual_source_identity',$3,'reviewed',$4)",[row.substanceId,id,component.relation,evidence]);
   await db.query("INSERT INTO knowledge.provider_ingredients(ingredient_id,provider,external_id,external_name,review_status,evidence) VALUES($1,'ddinter',$2,$3,'reviewed',$4) ON CONFLICT DO NOTHING",[id,component.providerId,component.providerName,evidence]);
  }
  await db.query("UPDATE knowledge.substances SET mapping_status='source_verified' WHERE id=$1",[row.substanceId]);added++;
 }
 await db.query('COMMIT');console.log(JSON.stringify({reviewedNames:67,addedCompleteCompositions:added,decisions:catalog.counts,clinicalUseApproved:false}));
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
