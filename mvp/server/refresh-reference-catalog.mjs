// Import-side publication hooks. Never expose them as web routes.
import {refreshReviewedCompositions} from './refresh-compositions.mjs';
export const REFERENCE_WRITE_LOCK=2026101911;
export async function lockReferenceWrite(db){await db.query('SELECT pg_advisory_xact_lock($1)',[REFERENCE_WRITE_LOCK]);}
export async function refreshReferenceCatalog(db,{statusOnly=false,instructionsOnly=false}={}){
 const compositions=statusOnly?{added:0,names:[]}:await refreshReviewedCompositions(db);
 await db.query(statusOnly?'SELECT knowledge.refresh_reference_status()':instructionsOnly&&!compositions.added?'SELECT knowledge.refresh_reference_instructions()':'SELECT knowledge.refresh_reference_catalog()');
 return compositions;
}
