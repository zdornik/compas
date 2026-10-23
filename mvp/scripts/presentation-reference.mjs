import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {databaseConfig,adminClient,root} from './database-tools.mjs';
import {openBlob,writeBlob,verifyBlob} from '../server/reference-files.mjs';
import {publishReaderIndex} from '../server/reference-reader.mjs';
import {lockReferenceWrite,refreshReferenceCatalog} from '../server/refresh-reference-catalog.mjs';

const id='cr:301_3',tables=['sources','documents','pages','page_assets'];
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function presentationReference({config,database,directory,fromLocal=false}){
  if(!/^compass_presentation_[a-f0-9]{12}$/.test(database))throw Error('Refusing a non-presentation target');
  const archive=join(directory,'reference/blobs'),manifest=join(directory,'reference/sample.json');
  await mkdir(archive,{recursive:true});let sample;
  if(fromLocal){
    const sourceConfig=await databaseConfig(),source=await adminClient(sourceConfig,process.env.DB_NAME||'compass');
    try{
      await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const document=(await source.query('SELECT to_jsonb(d) value FROM knowledge.documents d WHERE id=$1',[id])).rows[0]?.value;
      if(!document||document.kind!=='clinical_recommendation')throw Error('The reviewed official sample cr:301_3 is not available locally');
      sample={version:1,id,tables:{documents:[document]},objects:[]};
      sample.tables.sources=(await source.query('SELECT to_jsonb(s) value FROM knowledge.sources s WHERE id=$1',[document.source_id])).rows.map(row=>row.value);
      sample.tables.pages=(await source.query("SELECT to_jsonb(p)-'search_vector' value FROM knowledge.pages p WHERE document_id=$1 ORDER BY page",[id])).rows.map(row=>row.value);
      sample.tables.page_assets=(await source.query('SELECT to_jsonb(a) value FROM knowledge.page_assets a WHERE document_id=$1 ORDER BY id',[id])).rows.map(row=>row.value);
      if(sample.tables.pages.length>200||sample.tables.page_assets.length>100)throw Error('Sample exceeds the bounded presentation inventory');
      for(const row of [...sample.tables.documents,...sample.tables.page_assets]){
        let bytes;
        if(row.original){bytes=Buffer.from(row.original.slice(2),'hex');await writeBlob(archive,row.sha256,Readable.from([bytes]));}
        else{
          const file=await openBlob(process.env.REFERENCE_FILES_DIR||join(root,'knowledge/archive/blobs'),row.blob_key,Number(row.original_bytes));
          try{await writeBlob(archive,row.sha256,file.createReadStream({autoClose:false}));}finally{await file.close();}
        }
        row.original_bytes=bytes?.length||Number(row.original_bytes);row.blob_key=row.sha256;row.original=null;row.archive_verified_at=new Date().toISOString();
        sample.objects.push({sha256:row.sha256,bytes:row.original_bytes});
      }
      await source.query('COMMIT');
      const payload=JSON.stringify(sample);await writeFile(manifest,JSON.stringify({sha256:hash(payload),payload}),{mode:0o600});
    }catch(error){await source.query('ROLLBACK');throw error;}finally{await source.end();}
  }else{
    const envelope=JSON.parse(await readFile(manifest,'utf8'));
    if(hash(envelope.payload)!==envelope.sha256)throw Error('Presentation sample checksum mismatch');
    sample=JSON.parse(envelope.payload);
  }
  if(sample.version!==1||sample.id!==id||sample.tables.documents.length!==1||sample.tables.documents[0].id!==id)throw Error('Invalid presentation sample');
  for(const object of sample.objects)await verifyBlob(archive,object.sha256,object.bytes);
  const target=await adminClient(config,database);
  try{
    await target.query('BEGIN');await lockReferenceWrite(target);
    if((await target.query('SELECT 1 FROM knowledge.documents WHERE id<>$1 LIMIT 1',[id])).rows.length)throw Error('Presentation reference store contains another corpus');
    for(const table of tables){
      const columns=(await target.query("SELECT column_name FROM information_schema.columns WHERE table_schema='knowledge' AND table_name=$1 AND is_generated='NEVER' ORDER BY ordinal_position",[table])).rows.map(row=>'"'+row.column_name+'"').join(',');
      await target.query(`INSERT INTO knowledge.${table}(${columns}) SELECT ${columns} FROM json_populate_recordset(NULL::knowledge.${table},$1::json) ON CONFLICT DO NOTHING`,[JSON.stringify(sample.tables[table])]);
    }
    const actual=(await target.query('SELECT sha256 FROM knowledge.documents WHERE id=$1',[id])).rows[0];
    if(actual.sha256!==sample.tables.documents[0].sha256)throw Error('A different sample version is already present');
    await publishReaderIndex(target,id);await refreshReferenceCatalog(target,{statusOnly:true});await target.query('COMMIT');
  }catch(error){await target.query('ROLLBACK');throw error;}finally{await target.end();}
  return {documents:1,pages:sample.tables.pages.length,objects:sample.objects.length,bytes:sample.objects.reduce((sum,item)=>sum+item.bytes,0)};
}
