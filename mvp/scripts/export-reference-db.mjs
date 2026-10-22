import {packObjects} from './reference-objects.mjs';
import {referenceFilesRoot} from '../server/reference-files.mjs';
// Exports only the public knowledge schema. Never includes public/auth/care/LOs.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,open,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {pipeline} from 'node:stream/promises';
import {command,processDone,dockerSqlArgs,REFERENCE_REPOSITORY,IDENTIFIER,validateSnapshot,assertArchiveInventory} from './reference-snapshot.mjs';
const releaseAt=process.argv.indexOf('--release'),dateLabel=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());
const stamp=new Date().toISOString().replace(/[-:]/g,'').slice(0,15).replace('T','-'),release=releaseAt<0?'reference-db-'+dateLabel:process.argv[releaseAt+1],prefix='reference-db-'+stamp;
if(!/^reference-db-[a-zA-Z0-9._-]+$/.test(release||''))throw new Error('Invalid snapshot release tag');
const folder=resolve('backups/reference-export/'+prefix),partBytes=512*1024**2;
await mkdir(folder,{recursive:true});await mkdir('database',{recursive:true});
await command('gh',['auth','status'],{capture:false});
const releases=JSON.parse(await command('gh',['release','list','--repo',REFERENCE_REPOSITORY,'--limit','100','--json','tagName,isDraft']));
if(releases.some(r=>r.tagName===release))throw new Error('Snapshot release already exists; inspect it before starting another export');
const releaseRequest=resolve(folder,'release-request.json');
await writeFile(releaseRequest,JSON.stringify({tag_name:release,target_commitish:'main',draft:true,name:'Готовая справочная база Компас · '+dateLabel,body:'Снимок PostgreSQL схемы knowledge: клинреки, инструкции/PDF, разметка, ГРЛС, ЕСКЛП, МНН/переводы и исходные взаимодействия. Без аккаунтов, личных записей, сообщений и ключей. Исследовательское некоммерческое использование; исходные лицензии и ограничения сохранены в БД и репозитории. Части одного pg_dump, не исходные Excel/JSON. Восстановление — scripts/restore-reference-db.mjs.'}));
const releaseInfo=JSON.parse(await command('gh',['api','--method','POST',`repos/${REFERENCE_REPOSITORY}/releases`,'--input',releaseRequest]));
const releaseId=releaseInfo.id,getRelease=async()=>JSON.parse(await command('gh',['api',`repos/${REFERENCE_REPOSITORY}/releases/${releaseId}`]));
const coordinator=spawn('docker',dockerSqlArgs(),{stdio:['pipe','pipe','inherit']}),coordinatorDone=processDone(coordinator);coordinatorDone.catch(()=>{});
const lines=createInterface({input:coordinator.stdout})[Symbol.asyncIterator]();
const ask=async q=>{coordinator.stdin.write(q+';\n');const line=await lines.next();if(line.done)throw new Error('Snapshot coordinator closed');return JSON.parse(line.value);};
let exporter,exportDone,part,index=0,size=0,partHash;
try{
 coordinator.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n');
 const info=await ask("SELECT json_build_object('snapshot',pg_export_snapshot(),'capturedAt',clock_timestamp(),'serverVersion',current_setting('server_version'),'migrations',(SELECT json_agg(id ORDER BY id) FROM public.schema_migrations),'tables',(SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='knowledge'))");
 const tables=info.tables.filter(t=>t!=='catalog_state');
 if(tables.some(t=>!IDENTIFIER.test(t)||/(?:patient|auth|session|care_|chat)/.test(t)))throw new Error('Unexpected table in public reference schema');
 const counts=await ask('SELECT json_build_object('+tables.map(t=>`'${t}',(SELECT count(*)::bigint FROM knowledge."${t}")`).join(',')+')');
 const objects=await ask("SELECT coalesce(json_agg(x ORDER BY x.sha256),'[]'::json) FROM (SELECT blob_key AS sha256,max(original_bytes)::bigint AS bytes FROM (SELECT blob_key,original_bytes FROM knowledge.documents UNION ALL SELECT blob_key,original_bytes FROM knowledge.page_assets) b WHERE blob_key IS NOT NULL GROUP BY blob_key) x");
 const manifest={format:'postgresql-custom-data-v1',state:'exporting',repository:REFERENCE_REPOSITORY,release,schema:'knowledge',containsPatientData:false,containsSecrets:false,postgresMajor:17,capturedAt:info.capturedAt,serverVersion:info.serverVersion,requiredMigrations:info.migrations,tables:counts,excludedTables:['catalog_state'],parts:[],bytes:0,sha256:null};
 if(objects.length){manifest.format='postgresql-custom-data-v2';manifest.objects={format:'compass-reference-objects-v1',entries:objects.map(x=>({...x,bytes:Number(x.bytes)})),parts:[],bytes:0,sha256:null};}
 const fullHash=createHash('sha256');
 const checkpoint=()=>writeFile(resolve(folder,'checkpoint.json'),JSON.stringify(manifest,null,2));
 await checkpoint();
 exporter=spawn('docker',['compose','exec','-T','db','pg_dump','-U','compass_admin','-d','compass','--schema=knowledge','--data-only','--no-owner','--no-privileges','--no-large-objects','--exclude-table-data=knowledge.catalog_state','--format=custom','--compress=gzip:3','--snapshot='+info.snapshot],{stdio:['ignore','pipe','inherit']});
 exportDone=processDone(exporter);exportDone.catch(()=>{});
 const upload=async(path,name)=>{let last;for(let attempt=0;attempt<3;attempt++){try{await command('gh',['release','upload',release,path,'--repo',REFERENCE_REPOSITORY]);return;}catch(e){last=e;const remote=await getRelease();if(remote.assets.some(a=>a.name===name))return;console.error('Retrying snapshot upload',name,attempt+1);}}throw last;};
 const start=async()=>{index++;size=0;partHash=createHash('sha256');part={index,name:prefix+'.part-'+String(index).padStart(4,'0')};part.path=resolve(folder,part.name);part.file=await open(part.path,'wx',0o600);};
 const finish=async()=>{
  await part.file.sync();await part.file.close();const item={index:part.index,name:part.name,bytes:size,sha256:partHash.digest('hex')};
  console.log('Uploading database part',item.index,'bytes',item.bytes);await upload(part.path,part.name);
  const remote=await getRelease(),asset=remote.assets.find(a=>a.name===item.name);
  if(!asset||asset.size!==item.bytes)throw new Error('Uploaded snapshot size mismatch');
  if(asset.digest!=='sha256:'+item.sha256)throw new Error('GitHub snapshot checksum mismatch or unavailable');
  item.assetId=asset.id;manifest.parts.push(item);manifest.bytes+=item.bytes;await checkpoint();
  if(item.index===1){
   const list=spawn('docker',['compose','exec','-T','db','pg_restore','--list'],{stdio:['pipe','pipe','inherit']}),done=processDone(list);let toc='';list.stdout.on('data',b=>toc+=b);list.stdin.on('error',e=>{if(e.code!=='EPIPE')list.kill();});
   await pipeline(createReadStream(part.path,{end:1024*1024-1}),list.stdin).catch(e=>{if(e.code!=='EPIPE'&&e.code!=='ERR_STREAM_PREMATURE_CLOSE')throw e;});await done;
   assertArchiveInventory(toc,manifest.tables);
   await writeFile(resolve(folder,'archive-contents.txt'),toc);console.log('Archive inventory validated; knowledge only');
  }
  await unlink(part.path);part=null;console.log('Verified database part',item.index,'total MiB',Math.round(manifest.bytes/1024**2));
 };
 await start();
 for await(const buffer of exporter.stdout){let offset=0;fullHash.update(buffer);while(offset<buffer.length){const length=Math.min(partBytes-size,buffer.length-offset),slice=buffer.subarray(offset,offset+length);let written=0;while(written<slice.length){const result=await part.file.write(slice.subarray(written));if(!result.bytesWritten)throw new Error('Incomplete snapshot write');written+=result.bytesWritten;}partHash.update(slice);size+=length;offset+=length;if(size===partBytes){await finish();await start();}}}
 await exportDone;if(size)await finish();else{await part.file.close();await unlink(part.path);part=null;}
 manifest.sha256=fullHash.digest('hex');
 if(manifest.objects){
  const inventory=manifest.objects,hash=createHash('sha256');let handle,objectPart,objectHash,objectSize=0,objectIndex=0;
  const begin=async()=>{objectPart={index:++objectIndex,name:prefix+'.objects-'+String(objectIndex).padStart(4,'0')};objectPart.path=resolve(folder,objectPart.name);handle=await open(objectPart.path,'wx',0o600);objectHash=createHash('sha256');objectSize=0;};
  const finishObject=async()=>{await handle.sync();await handle.close();handle=null;const entry={index:objectPart.index,name:objectPart.name,bytes:objectSize,sha256:objectHash.digest('hex')};await upload(objectPart.path,entry.name);const remote=await getRelease(),asset=remote.assets.find(a=>a.name===entry.name);if(!asset||asset.size!==entry.bytes||asset.digest!=='sha256:'+entry.sha256)throw new Error('Uploaded object archive checksum mismatch');entry.assetId=asset.id;inventory.parts.push(entry);inventory.bytes+=entry.bytes;await checkpoint();await unlink(objectPart.path);};
  try{
   await begin();for await(const chunk of packObjects(referenceFilesRoot(),inventory.entries)){hash.update(chunk);let offset=0;while(offset<chunk.length){const slice=chunk.subarray(offset,offset+Math.min(partBytes-objectSize,chunk.length-offset));let written=0;while(written<slice.length){const result=await handle.write(slice.subarray(written));if(!result.bytesWritten)throw new Error('Incomplete object archive write');written+=result.bytesWritten;}objectHash.update(slice);objectSize+=slice.length;offset+=slice.length;if(objectSize===partBytes){await finishObject();await begin();}}}
   if(objectSize)await finishObject();else{await handle.close();handle=null;await unlink(objectPart.path);}inventory.sha256=hash.digest('hex');
  }finally{if(handle)await handle.close().catch(()=>{});}
 }
 manifest.state='ready';validateSnapshot(manifest);await checkpoint();
 const manifestPath=resolve(folder,'reference-snapshot.json');await writeFile(manifestPath,JSON.stringify(manifest,null,2));await upload(manifestPath,'reference-snapshot.json');
 await writeFile('database/reference-snapshot.json.tmp',JSON.stringify(manifest,null,2));await rename('database/reference-snapshot.json.tmp','database/reference-snapshot.json');
 console.log(JSON.stringify({exported:true,bytes:manifest.bytes,parts:manifest.parts.length,sha256:manifest.sha256,release,state:'draft',patientDataExported:false}));
}finally{
 if(part)await part.file.close().catch(()=>{});if(exporter&&!exporter.killed)exporter.kill();
 coordinator.stdin.end('ROLLBACK;\n');await coordinatorDone.catch(()=>{});
}
