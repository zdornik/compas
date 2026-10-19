// Source-only integration check. Synthetic reference rows are always rolled back.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createKnowledgeApi} from './knowledge.mjs';
import {searchCatalogProducts,catalogSuggestions,catalogSubstanceProducts} from './reference-catalog.mjs';
import {parseKnowledgeQuery} from './knowledge.mjs';
import {lockReferenceWrite,refreshReferenceCatalog} from './refresh-reference-catalog.mjs';
const pool=new pg.Pool({host:'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:2});
const db=await pool.connect();
try{
 const fixture=JSON.parse(await readFile('qa/reference-benchmark-before.json'));
 for(const sample of fixture.results){
  const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
  await createKnowledgeApi(db)({method:'GET',url:sample.path},res,sample.path.split('?')[0]);
  assert.equal(res.status,200,sample.name);assert.deepEqual(res.body,sample.response,sample.name+' response parity');
 }
 for(const query of ['', '?scope=psychiatry','?allStatuses=1','?scope=psychiatry&allStatuses=1','?q=unlikely-reference-probe-xyz','?q=%25%5F','?offset=1000000']){
  const result=await searchCatalogProducts(db,parseKnowledgeQuery(query));assert.ok(Number.isInteger(result.total));assert.ok(Array.isArray(result.items));
 }
 const klp=fixture.results.find(row=>row.name==='code-klp').path.split('q=')[1];
 await catalogSuggestions(db,decodeURIComponent(klp));
 const substanceId=fixture.results.find(row=>row.name==='products-ru').response.items[0].substanceId;
 assert.ok((await catalogSubstanceProducts(db,substanceId)).items.length);
 const privileges=(await db.query(`SELECT has_table_privilege('compass_app','knowledge.catalog_products','SELECT') can_read,has_table_privilege('compass_app','knowledge.catalog_products','UPDATE') can_write,has_function_privilege('compass_app','knowledge.refresh_reference_catalog()','EXECUTE') can_refresh,has_function_privilege('compass_app','knowledge.refresh_reference_status()','EXECUTE') can_refresh_status`)).rows[0];
 assert.deepEqual(privileges,{can_read:true,can_write:false,can_refresh:false,can_refresh_status:false});
 const before=(await db.query('SELECT generation,counts,totals FROM knowledge.catalog_state WHERE singleton')).rows[0];
 const id='catalog-probe:'+randomUUID();
 await db.query('BEGIN');await lockReferenceWrite(db);
 await db.query(`INSERT INTO knowledge.substances(id,name_ru,normalized_name,source_id,kind) VALUES($1,$1,$1,'grls','substance')`,[id]);
 await db.query(`INSERT INTO knowledge.products(id,source_id,registration_number,trade_name,inn,substance_id,form,source_status) VALUES($1,'grls',$1,$1,$1,$1,'','Действующий')`,[id]);
 await refreshReferenceCatalog(db);
 assert.equal((await db.query('SELECT count(*)::int n FROM knowledge.catalog_products WHERE id=$1',[id])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM knowledge.catalog_products WHERE id=$1',[id])).rows[0].n,0,'Concurrent reader must see previous complete catalog');
 assert.deepEqual((await pool.query('SELECT generation,counts,totals FROM knowledge.catalog_state WHERE singleton')).rows[0],before);
 await db.query('ROLLBACK');
 assert.deepEqual((await db.query('SELECT generation,counts,totals FROM knowledge.catalog_state WHERE singleton')).rows[0],before,'A failed import must preserve published state');
 assert.equal((await db.query('SELECT count(*)::int n FROM knowledge.products WHERE id=$1',[id])).rows[0].n,0);
 console.log(JSON.stringify({baselineResponsesEqual:fixture.results.length,edgeQueries:9,atomicPublication:true,rollbackPreservedSources:true,runtimeReadOnly:true,patientDataRead:false,patientDataWritten:false}));
}finally{await db.query('ROLLBACK').catch(()=>{});db.release();await pool.end();}
