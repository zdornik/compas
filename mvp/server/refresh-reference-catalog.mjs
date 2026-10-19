// Import-side publication hooks. Never expose them as web routes.
export const REFERENCE_WRITE_LOCK=2026101911;
export async function lockReferenceWrite(db){await db.query('SELECT pg_advisory_xact_lock($1)',[REFERENCE_WRITE_LOCK]);}
export async function refreshReferenceCatalog(db,{statusOnly=false}={}){await db.query(statusOnly?'SELECT knowledge.refresh_reference_status()':'SELECT knowledge.refresh_reference_catalog()');}
