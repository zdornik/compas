// Public source files only. A content hash is the only permitted object key.
import {constants} from 'node:fs';
import {mkdir,open,link,unlink,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const BLOB_KEY=/^[a-f0-9]{64}$/;
export const referenceFilesRoot=()=>resolve(process.env.REFERENCE_FILES_DIR||'knowledge/archive/blobs');
export function blobPath(root,key){
 if(!BLOB_KEY.test(key))throw new Error('Invalid reference object key');
 return resolve(root,key.slice(0,2),key.slice(2,4),key);
}
async function safeParent(root,path,create=false){
 root=resolve(root);if(create)await mkdir(root,{recursive:true});
 const actualRoot=await realpath(root);
 // Check each parent before creating its child, including during offline writes.
 let parent=actualRoot;for(const part of path.slice(root.length+1).split(sep).slice(0,-1)){
  parent=resolve(parent,part);if(create)await mkdir(parent).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const info=await lstat(parent);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe reference directory');
 }
 const actualParent=await realpath(dirname(path));
 // A configured root may itself be a mount/symlink; no descendant may escape it.
 if(actualParent!==actualRoot&&!actualParent.startsWith(actualRoot+sep))throw new Error('Reference object outside archive');
 return resolve(actualParent,path.slice(dirname(path).length+1));
}
export async function openBlob(root,key,expectedBytes){
 const path=await safeParent(root,blobPath(root,key));
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await file.stat();if(!info.isFile()||info.size!==Number(expectedBytes))throw new Error('Reference object size mismatch');return file;}catch(error){await file.close();throw error;}
}
export async function verifyBlob(root,key,expectedBytes){
 const file=await openBlob(root,key,expectedBytes),hash=createHash('sha256');
 try{for await(const chunk of file.createReadStream({autoClose:false}))hash.update(chunk);if(hash.digest('hex')!==key)throw new Error('Reference object checksum mismatch');}finally{await file.close();}
 return {key,bytes:Number(expectedBytes)};
}
export async function writeBlob(root,key,source){
 const path=await safeParent(root,blobPath(root,key),true),temporary=path+'.'+randomUUID()+'.tmp';
 let file,bytes=0;const hash=createHash('sha256');
 try{
  file=await open(temporary,'wx',0o644);
  for await(const value of source){const chunk=Buffer.from(value);hash.update(chunk);bytes+=chunk.length;let offset=0;while(offset<chunk.length){const {bytesWritten}=await file.write(chunk.subarray(offset));if(!bytesWritten)throw new Error('Incomplete reference write');offset+=bytesWritten;}}
  if(!bytes||hash.digest('hex')!==key)throw new Error('Reference source checksum mismatch');
  await file.sync();await file.close();file=null;
  // Link publishes atomically without replacing an existing object.
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
  const folder=await open(dirname(path),'r');try{await folder.sync();}finally{await folder.close();}
  await verifyBlob(root,key,bytes);return {key,bytes};
 }finally{if(file)await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export function parseByteRange(header,size){
 if(header===undefined)return null;
 const match=String(header).match(/^bytes=(\d*)-(\d*)$/);
 if(!match||!match[1]&&!match[2])return false;
 let start,end;
 if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return false;start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start<0||end<start)return false;
 return {start,end:Math.min(end,size-1)};
}
export const matchesEtag=(value,etag)=>String(value||'').split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===etag.replace(/^W\//,''));
export function publicFileHeaders(hash,version){
 if(version!==null&&version!==hash)throw Object.assign(new Error('Версия документа изменилась. Откройте документ заново.'),{status:409});
 return {ETag:'"'+hash+'"','Cache-Control':version===hash?'public, max-age=31536000, immutable':'public, no-cache','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
}
export async function* databaseFile(pool,table,where,params,hash,start,end){
 // Migration fallback: bounded SQL slices, never load a complete bytea into Node.
 for(let offset=start;offset<=end;){
  const length=Math.min(256*1024,end-offset+1);
  const row=(await pool.query(`SELECT substring(original from $${params.length+2} for $${params.length+3}) AS chunk FROM knowledge.${table} WHERE ${where} AND sha256=$${params.length+1}`,[...params,hash,offset+1,length])).rows[0];
  if(!row?.chunk||row.chunk.length!==length)throw new Error('Reference source changed or unavailable');offset+=length;yield row.chunk;
 }
}
export async function deliverReferenceFile(req,res,{pool,table,where,params,root=referenceFilesRoot(),filename}){
 if(!['documents','page_assets'].includes(table))throw new Error('Invalid reference table');
 const row=(await pool.query(`SELECT sha256,mime_type,blob_key,coalesce(original_bytes,octet_length(original))::text AS bytes FROM knowledge.${table} WHERE ${where}`,params)).rows[0];
 if(!row)throw Object.assign(new Error('Оригинал не найден'),{status:404});
 const size=Number(row.bytes);if(!Number.isSafeInteger(size)||size<1)throw new Error('Invalid reference size');
 const url=new URL(req.url,'http://localhost'),headers={...publicFileHeaders(row.sha256,url.searchParams.get('v')),'Content-Type':row.mime_type};
 if(filename)headers['Content-Disposition']=`inline; filename="${filename}.${row.mime_type==='image/jpeg'?'jpg':row.mime_type==='image/png'?'png':'pdf'}"`;
 if(matchesEtag(req.headers?.['if-none-match'],headers.ETag)){res.writeHead(304,headers);res.end();return;}
 const range=req.method==='HEAD'?null:req.headers?.['if-range']&&req.headers['if-range']!==headers.ETag?null:parseByteRange(req.headers?.range,size);
 if(range===false){res.writeHead(416,{...headers,'Content-Range':'bytes */'+size,'Content-Length':0});res.end();return;}
 const start=range?.start??0,end=range?.end??size-1;
 headers['Content-Length']=end-start+1;if(range)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
 let file;
 try{
  // Open before headers so a missing archive produces a retryable 503, not a broken 200.
  if(row.blob_key)file=await openBlob(root,row.blob_key,size);
  res.writeHead(range?206:200,headers);if(req.method==='HEAD'){res.end();return;}
  const source=file?file.createReadStream({start,end,autoClose:false,highWaterMark:256*1024}):databaseFile(pool,table,where,params,row.sha256,start,end);
  const {pipeline}=await import('node:stream/promises');await pipeline(source,res);
 }finally{if(file)await file.close().catch(()=>{});}
}
