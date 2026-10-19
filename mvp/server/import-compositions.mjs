// Public reference data only. No new provider IDs, patient reads or prescriptions.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {lockReferenceWrite,refreshReferenceCatalog} from './refresh-reference-catalog.mjs';
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1}),db=await pool.connect();
try{
 await db.query('BEGIN');await lockReferenceWrite(db);const result=await refreshReferenceCatalog(db);await db.query('COMMIT');
 console.log(JSON.stringify({...result,patientDataRead:false,patientDataWritten:false,clinicalUseApproved:false}));
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
