import {archiveReferenceRow} from './publish-reference-files.mjs';
import {publishReaderIndex} from './reference-reader.mjs';
import {lockReferenceWrite,refreshReferenceCatalog} from './refresh-reference-catalog.mjs';
// Offline enrichment importer. Public source documents only; never handles a patient record.
import pg from 'pg';
import { readFile,readdir,stat } from 'node:fs/promises';
import { resolve,sep } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve('knowledge');
const password=(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim();
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:process.env.DB_NAME||'compass',port:Number(process.env.DB_PORT||5432),user:'compass_admin',password,max:1});
const client=await pool.connect(),seen=new Map();
const requiredExtractor='pdfplumber-0.11.9-layout-v4';
async function importOne(path) {
 const item=JSON.parse(await readFile(path,'utf8'));
 if(item.extractor!==requiredExtractor)return false;
 const record=(await client.query('SELECT sha256,metadata FROM knowledge.documents WHERE id=$1',[item.documentId])).rows[0];
 if(!record)return false;
 if(record.sha256!==item.sourceSha256)throw new Error('Layout does not match its original PDF');
 if(record.metadata.layoutExtractor===item.extractor&&!process.argv.includes('--rebuild'))return true;
 const count=Number((await client.query('SELECT count(*) n FROM knowledge.pages WHERE document_id=$1',[item.documentId])).rows[0].n);
 if(item.pages.length!==count)throw new Error('Layout page count does not match its source');
 const assets=[];
 for(const asset of item.assets){const file=resolve(asset.filePath);if(!file.startsWith(root+sep))throw new Error('Asset outside source archive');const bytes=await readFile(file);
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw new Error('Invalid source image');
  assets.push({...asset,bytes});
 }
 await client.query('BEGIN');
 await lockReferenceWrite(client);
 try {
  await client.query(`UPDATE knowledge.pages p SET text_content=x.text,layout=x.layout FROM jsonb_to_recordset($2::jsonb) AS x(page integer,text text,layout jsonb) WHERE p.document_id=$1 AND p.page=x.page`,[item.documentId,JSON.stringify(item.pages)]);
  for(const asset of assets)await client.query(`INSERT INTO knowledge.page_assets(document_id,page,id,mime_type,sha256,original) VALUES($1,$2,$3,'image/png',$4,$5) ON CONFLICT(document_id,id) DO UPDATE SET page=EXCLUDED.page,sha256=EXCLUDED.sha256,original=EXCLUDED.original,blob_key=NULL,original_bytes=NULL,archive_verified_at=NULL`,[item.documentId,asset.page,asset.id,asset.sha256,asset.bytes]);
  await client.query('DELETE FROM knowledge.page_assets WHERE document_id=$1 AND NOT(id=ANY($2::text[]))',[item.documentId,assets.map(asset=>asset.id)]);
  for(const asset of assets)await archiveReferenceRow(client,'page_assets','document_id=$1 AND id=$2',[item.documentId,asset.id]);
  if(item.documentId.startsWith('cr:'))await client.query('DELETE FROM knowledge.mentions WHERE document_id=$1',[item.documentId]);
  if(item.documentId.startsWith('cr:')&&item.mentions.length)await client.query(`INSERT INTO knowledge.mentions(document_id,page,substance_id,start_offset,matched_text,context,method,review_status)
   SELECT $1,x.page,x."substanceId",x."startOffset",x."matchedText",x.context,'exact_registry_name_tokenized_layout','unreviewed_mention' FROM jsonb_to_recordset($2::jsonb) AS x(page integer,"substanceId" text,"startOffset" integer,"matchedText" text,context text) ON CONFLICT DO NOTHING`,[item.documentId,JSON.stringify(item.mentions)]);
  await client.query(`UPDATE knowledge.documents SET metadata=metadata||$2::jsonb WHERE id=$1`,[item.documentId,JSON.stringify({layoutExtractor:item.extractor,layoutCounts:item.counts,layoutJoiningChanges:item.joiningChanges.length})]);
  await publishReaderIndex(client,item.documentId);
  await client.query('COMMIT');console.log(JSON.stringify({document:item.documentId,pages:count,...item.counts,sourceImages:assets.length,joiningChanges:item.joiningChanges.length}));return true;
 }catch(error){await client.query('ROLLBACK');throw error;}
}
try {
 await client.query('SELECT pg_advisory_lock(2026101803)');
 const instructions=process.argv.includes('--instructions');
 const expected=instructions?Infinity:JSON.parse(await readFile(resolve(root,'clinical-manifest.json'),'utf8')).selectedTotal;
 do {
  let names=[];try{names=(await readdir(resolve(root,'processed/layout'))).filter(name=>(instructions?/^[a-f0-9]{32}\.json$/:/^\d+_\d+\.json$/).test(name));}catch(error){if(error.code!=='ENOENT')throw error;}
  let changed=false;
  for(const name of names){const path=resolve(root,'processed/layout',name),modified=(await stat(path)).mtimeMs;if(seen.get(name)===modified)continue;if(await importOne(path)){seen.set(name,modified);changed=true;}}
  if(changed)await refreshReferenceCatalog(client,{statusOnly:true});
  if(!process.argv.includes('--follow')||seen.size>=expected)break;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }while(true);
 console.log('Layout import complete:',seen.size,'documents');
}catch(error){console.error('Layout import failed:',error.message);process.exitCode=1;}
finally{await client.query('SELECT pg_advisory_unlock(2026101803)').catch(()=>{});client.release();await pool.end();}
