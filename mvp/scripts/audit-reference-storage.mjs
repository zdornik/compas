// Read-only measurements of the public reference schema. No account/health tables.
import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
const password=(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim();
const pool=new pg.Pool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME||'compass',user:process.env.REFERENCE_DB_USER||'compass_app',password,max:1});
try{
 await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const documents=(await pool.query(`SELECT kind,count(*)::int AS documents,coalesce(sum(coalesce(original_bytes,octet_length(original))),0)::text AS "originalBytes",coalesce(sum(octet_length(original)),0)::text AS "embeddedBytes",coalesce(sum(original_bytes) FILTER(WHERE blob_key IS NOT NULL),0)::text AS "archivedBytes",count(DISTINCT sha256)::int AS "uniqueOriginals" FROM knowledge.documents GROUP BY kind ORDER BY kind`)).rows;
 const assets=(await pool.query(`SELECT count(*)::int AS assets,coalesce(sum(coalesce(original_bytes,octet_length(original))),0)::text AS "originalBytes",coalesce(sum(octet_length(original)),0)::text AS "embeddedBytes",coalesce(sum(original_bytes) FILTER(WHERE blob_key IS NOT NULL),0)::text AS "archivedBytes",count(DISTINCT sha256)::int AS "uniqueAssets" FROM knowledge.page_assets`)).rows[0];
 const pages=(await pool.query(`SELECT count(*)::int AS pages,coalesce(sum(octet_length(text_content)),0)::text AS "textBytes",coalesce(sum(pg_column_size(layout)),0)::text AS "layoutStoredBytes",count(*) FILTER(WHERE layout::text LIKE '%source_character_coverage_mismatch%')::int AS "fallbackPages" FROM knowledge.pages`)).rows[0];
 const relations=(await pool.query(`SELECT c.relname AS name,pg_total_relation_size(c.oid)::text AS "totalBytes" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='knowledge' AND c.relkind='r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12`)).rows;
 const objects=(await pool.query(`SELECT count(*)::int AS objects,coalesce(sum(bytes),0)::text AS bytes FROM (SELECT sha256,max(original_bytes) AS bytes FROM (SELECT sha256,original_bytes FROM knowledge.documents WHERE blob_key IS NOT NULL UNION ALL SELECT sha256,original_bytes FROM knowledge.page_assets WHERE blob_key IS NOT NULL) b GROUP BY sha256) x`)).rows[0];
 const largest=(await pool.query(`SELECT id,kind,title,coalesce(original_bytes,octet_length(original))::text AS bytes FROM knowledge.documents ORDER BY coalesce(original_bytes,octet_length(original)) DESC NULLS LAST LIMIT 10`)).rows;
 await pool.query('ROLLBACK');
 const report={measuredAt:new Date().toISOString(),scope:'knowledge only; personal data excluded',documents,assets,pages,objects,relations,largest};
 const output=JSON.stringify(report,null,2)+'\n',at=process.argv.indexOf('--out');if(at>=0)await writeFile(process.argv[at+1],output);
 console.log(output);
}finally{await pool.end();}
