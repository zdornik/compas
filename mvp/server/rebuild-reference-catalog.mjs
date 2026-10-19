// Offline maintenance only. Rebuild derived public data without touching patients.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {lockReferenceWrite,refreshReferenceCatalog} from './refresh-reference-catalog.mjs';
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1});
const db=await pool.connect();
try{
 await db.query('BEGIN');await lockReferenceWrite(db);await refreshReferenceCatalog(db);
 const state=(await db.query('SELECT generation,refreshed_at,totals FROM knowledge.catalog_state WHERE singleton')).rows[0];
 await db.query('COMMIT');console.log(JSON.stringify(state));
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
