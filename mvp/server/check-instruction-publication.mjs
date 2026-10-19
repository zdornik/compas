// Synthetic public-reference rows only, always rolled back.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {lockReferenceWrite,refreshReferenceCatalog} from './refresh-reference-catalog.mjs';
const pool=new pg.Pool({host:'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1}),db=await pool.connect(),id='instruction-probe:'+randomUUID();
try{
 await db.query('BEGIN');await lockReferenceWrite(db);
 const doc=(await db.query("SELECT id FROM knowledge.documents WHERE kind='drug_instruction' ORDER BY id LIMIT 1")).rows[0].id;
 await db.query(`INSERT INTO knowledge.substances(id,name_ru,normalized_name,source_id,kind) VALUES($1,$1,$1,'grls','substance')`,[id]);
 await db.query(`INSERT INTO knowledge.products(id,source_id,registration_number,trade_name,inn,substance_id,form,source_status) VALUES($1,'grls',$1,$1,$1,$1,'','Действующий')`,[id]);
 await refreshReferenceCatalog(db);
 const fingerprint=async()=>(await db.query("SELECT md5(string_agg(substance_id||kind||term||xmin::text,'' ORDER BY substance_id,kind,term)) value FROM knowledge.catalog_terms")).rows[0].value;
 const before=await fingerprint();
 for(const [documentId,expected] of [[doc,1],[null,0]]){
  await db.query('UPDATE knowledge.products SET instruction_document_id=$2 WHERE id=$1',[id,documentId]);
  await refreshReferenceCatalog(db,{instructionsOnly:true});
  const count=(await db.query('SELECT ready_count FROM knowledge.catalog_substances WHERE id=$1',[id])).rows[0].ready_count;
  assert.equal(count,expected);assert.equal(await fingerprint(),before,'PDF availability must not rewrite naming dictionaries');
 }
 assert.equal((await db.query("SELECT has_function_privilege('compass_app','knowledge.refresh_reference_instructions()','EXECUTE') allowed")).rows[0].allowed,false);
 await db.query('ROLLBACK');assert.equal((await db.query('SELECT count(*)::int n FROM knowledge.products WHERE id=$1',[id])).rows[0].n,0);
 console.log(JSON.stringify({readyCountAddAndRemove:true,namingDictionariesUnchanged:true,runtimeReadOnly:true,syntheticChangesRolledBack:true,patientDataRead:false,patientDataWritten:false}));
}finally{await db.query('ROLLBACK').catch(()=>{});db.release();await pool.end();}
