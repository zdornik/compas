// Public source search/collection only. No provider identities or patient writes.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {lockReferenceWrite,refreshReferenceCatalog} from './refresh-reference-catalog.mjs';
const manifest=JSON.parse(await readFile('knowledge/chronic-scope.json'));
const aliases=JSON.parse(await readFile('knowledge/processed/chronic-search-aliases.json'));
const registry=JSON.parse(await readFile('knowledge/grls-manifest.json'));
if(manifest.scope!=='chronic'||manifest.registrySha256!==registry.sha256||manifest.registrySnapshot!==registry.snapshotDate)throw new Error('Collection does not match registry snapshot');
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1});const db=await pool.connect();
try{
 await db.query('BEGIN');await lockReferenceWrite(db);
 await db.query(`INSERT INTO knowledge.sources(id,name,url,license,coverage,retrieved_at,metadata) VALUES('grls-chronic-collection','Расширенный отбор инструкций ГРЛС','https://grls.minzdrav.gov.ru/grls.aspx','Условия ГРЛС; локальное некоммерческое исследование','Поиск по исходным фармакотерапевтическим группам; не клинический формуляр',now(),$1::jsonb) ON CONFLICT(id) DO UPDATE SET metadata=EXCLUDED.metadata,retrieved_at=EXCLUDED.retrieved_at`,[JSON.stringify({...manifest,snapshotDate:manifest.registrySnapshot,selectedTotal:manifest.registryNames})]);
 const missing=(await db.query(`SELECT DISTINCT x.name FROM jsonb_to_recordset($1::jsonb) x(name text) WHERE NOT EXISTS(SELECT 1 FROM knowledge.substances s WHERE s.name_ru=x.name AND s.source_id='grls')`,[JSON.stringify(aliases)])).rows;
 if(missing.length)throw new Error('Collection contains unknown registry INNs');
 await db.query("DELETE FROM knowledge.substance_search_aliases WHERE source_id='grls-chronic-collection'");
 const result=await db.query(`INSERT INTO knowledge.substance_search_aliases(alias,substance_id,source_id,evidence) SELECT lower(x.alias),s.id,'grls-chronic-collection',jsonb_build_object('sourceGroups',x."sourceGroups",'registrySnapshot',$2::text,'registrySha256',$3::text,'classificationOnly',true) FROM jsonb_to_recordset($1::jsonb) x(name text,alias text,"sourceGroups" jsonb) JOIN knowledge.substances s ON s.name_ru=x.name AND s.source_id='grls'`,[JSON.stringify(aliases),manifest.registrySnapshot,manifest.registrySha256]);
 await refreshReferenceCatalog(db);await db.query('COMMIT');
 console.log(JSON.stringify({registryNames:manifest.registryNames,queuedRegistrations:manifest.targetRegistrations,aliases:result.rowCount,providerIdentitiesChanged:0,patientDataRead:false,patientDataWritten:false}));
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
