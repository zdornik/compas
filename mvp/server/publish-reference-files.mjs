// Offline publication only. Runtime never imports, extracts, or modifies source documents.
import {writeBlob,verifyBlob,openBlob,databaseFile,referenceFilesRoot} from './reference-files.mjs';
import {publishReaderIndex,READER_VERSION} from './reference-reader.mjs';
import {REFERENCE_WRITE_LOCK} from './refresh-reference-catalog.mjs';
export async function archiveReferenceRow(client,table,where,params,{root=referenceFilesRoot(),verify=false}={}){
 const row=(await client.query(`SELECT sha256,blob_key,original IS NOT NULL AS embedded,coalesce(original_bytes,octet_length(original))::text AS bytes FROM knowledge.${table} WHERE ${where}`,params)).rows[0];
 if(!row)throw new Error('Reference row not found');
 if(!row.blob_key){await writeBlob(root,row.sha256,databaseFile(client,table,where,params,row.sha256,0,Number(row.bytes)-1));}
 else if(verify||row.embedded)await verifyBlob(root,row.blob_key,row.bytes);
 else{const file=await openBlob(root,row.blob_key,row.bytes);await file.close();}
 if(!row.blob_key||row.embedded)await client.query(`UPDATE knowledge.${table} SET blob_key=sha256,original_bytes=$${params.length+1},archive_verified_at=now(),original=NULL WHERE ${where} AND sha256=$${params.length+2}`,[...params,row.bytes,row.sha256]);
 return {bytes:Number(row.bytes),moved:row.embedded};
}
export async function publishReferenceFiles(client,{root=referenceFilesRoot(),id,indexOnly=false,verify=false,onDocument=()=>{}}={}){
 await client.query('SELECT pg_advisory_lock($1)',[REFERENCE_WRITE_LOCK]);
 let movedBytes=0,objects=0,documents=0;
 try{
  const rows=(await client.query(`SELECT d.id,coalesce(i.source_sha256=d.sha256 AND i.manifest->>'version'=$2,false) AS indexed FROM knowledge.documents d LEFT JOIN knowledge.reader_indexes i ON i.document_id=d.id WHERE ($1::text IS NULL OR d.id=$1) ORDER BY d.id`,[id||null,String(READER_VERSION)])).rows;
  for(const row of rows){
   await client.query('BEGIN');
   try{
    if(!indexOnly){
     const original=await archiveReferenceRow(client,'documents','id=$1',[row.id],{root,verify});objects++;if(original.moved)movedBytes+=original.bytes;
     const assets=(await client.query('SELECT id FROM knowledge.page_assets WHERE document_id=$1 ORDER BY id',[row.id])).rows;
     for(const asset of assets){const item=await archiveReferenceRow(client,'page_assets','document_id=$1 AND id=$2',[row.id,asset.id],{root,verify});objects++;if(item.moved)movedBytes+=item.bytes;}
    }
    if(!row.indexed||indexOnly)await publishReaderIndex(client,row.id);
    await client.query('COMMIT');documents++;onDocument({document:row.id,documents,movedBytes,objects});
   }catch(error){await client.query('ROLLBACK');throw error;}
  }
  return {documents,objects,movedBytes,storage:root};
 }finally{await client.query('SELECT pg_advisory_unlock($1)',[REFERENCE_WRITE_LOCK]);}
}
