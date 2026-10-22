import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
// Checks run in the SAME transaction as COPY. No partially restored reference store.
export function restoreChecksSql(manifest){
 const counts=Object.entries(manifest.tables).map(([table,count])=>`IF (SELECT count(*) FROM knowledge."${table}")<>${count} THEN RAISE EXCEPTION 'Reference row count mismatch'; END IF;`).join('\n');
 const entries=JSON.stringify(manifest.objects?.entries||[]);
 return `DO $reference_restore$ BEGIN
 ${counts}
 IF EXISTS (
  WITH actual AS (SELECT blob_key AS sha256,max(original_bytes)::bigint AS bytes FROM
   (SELECT blob_key,original_bytes FROM knowledge.documents UNION ALL SELECT blob_key,original_bytes FROM knowledge.page_assets) b WHERE blob_key IS NOT NULL GROUP BY blob_key),
  expected AS (SELECT * FROM jsonb_to_recordset('${entries}'::jsonb) AS x(sha256 text,bytes bigint))
  (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)
 ) THEN RAISE EXCEPTION 'Reference object inventory mismatch'; END IF;
 END $reference_restore$;
 SELECT knowledge.refresh_reference_status();
 COMMIT;\n`;
}
const done=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('Reference restore process failed')));});
export async function restoreReferenceStream(bytes,manifest,{decoder,sql}){
 const decode=spawn(decoder.file,decoder.args,{...decoder.options,stdio:['pipe','pipe','inherit']}),session=spawn(sql.file,sql.args,{...sql.options,stdio:['pipe','ignore','inherit']});
 const decoded=done(decode),committed=done(session);decoded.catch(()=>{});committed.catch(()=>{});session.stdin.on('error',()=>{});
 try{
  session.stdin.write('BEGIN;\n');
  await Promise.all([pipeline(Readable.from(bytes),decode.stdin),pipeline(decode.stdout,session.stdin,{end:false}),decoded]);
  session.stdin.end(restoreChecksSql(manifest));await committed;
 }catch(error){decode.kill();session.kill();await Promise.allSettled([decoded,committed]);throw error;}
}
