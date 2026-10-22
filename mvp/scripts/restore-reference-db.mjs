import {restoreReferenceStream} from './restore-reference-stream.mjs';
import {unpackObjects} from './reference-objects.mjs';
import {referenceFilesRoot,verifyBlob} from '../server/reference-files.mjs';
// Local administrator tool. Refuses to overwrite an existing reference database.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,lstat,unlink,rename,statfs} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {command,processDone,fileHash,sql,validateSnapshot,assertArchiveInventory,REFERENCE_REPOSITORY,dockerSqlArgs} from './reference-snapshot.mjs';
const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const database=arg('--database')||'compass';
if(!/^(?:compass|compass_reference_qa_[a-f0-9]+)$/.test(database))throw new Error('Unsupported restore target');
const manifest=validateSnapshot(JSON.parse(await readFile(arg('--manifest')||new URL('../database/reference-snapshot.json',import.meta.url),'utf8')));
const localParts=arg('--local-parts');
const tables=Object.keys(manifest.tables),statement='SELECT json_build_object('+tables.map(t=>`'${t}',(SELECT count(*)::bigint FROM knowledge."${t}")`).join(',')+')';
const counts=async()=>JSON.parse(await sql(statement,{database}));
const compare=actual=>{for(const t of tables)if(actual[t]!==manifest.tables[t])throw new Error(`Reference count mismatch: ${t} (${actual[t]} != ${manifest.tables[t]})`);};
const current=await counts();
if(args.includes('--verify')){
 compare(current);
 const objects=JSON.parse(await sql("SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT blob_key AS sha256,max(original_bytes)::bigint AS bytes FROM (SELECT blob_key,original_bytes FROM knowledge.documents UNION ALL SELECT blob_key,original_bytes FROM knowledge.page_assets) b WHERE blob_key IS NOT NULL GROUP BY blob_key) x",{database}));
 for(const object of objects)await verifyBlob(referenceFilesRoot(),object.sha256,object.bytes);
 console.log('Reference snapshot row counts and archived object checksums verified.');process.exit(0);
}
if(Object.values(current).some(n=>n!==0)){console.log('Existing reference database retained; automatic restore skipped.');process.exit(0);}
const installed=JSON.parse(await sql("SELECT coalesce(json_agg(id),'[]'::json) FROM public.schema_migrations",{database}));
if(!Array.isArray(manifest.requiredMigrations)||manifest.requiredMigrations.some(id=>!installed.includes(id)))throw new Error('Apply the repository database migrations before restoring the snapshot');
const disk=await statfs('.',{bigint:true}),available=disk.bavail*disk.bsize;
const required=BigInt(Math.ceil((manifest.estimatedDatabaseBytes||manifest.bytes)*1.5+(manifest.objects?.bytes||0)+2*1024**3));
if(available<required)throw new Error(`Not enough disk space for the reference database: need about ${Math.ceil(Number(required)/1024**3)} GiB free`);
const folder=resolve('backups/reference-download',manifest.sha256);await mkdir(folder,{recursive:true,mode:0o700});
const marker=resolve(folder,'restore-state.json');await writeFile(marker,JSON.stringify({state:'restoring',database,startedAt:new Date().toISOString(),snapshot:manifest.sha256}));
if(!localParts)await command('gh',['api','repos/'+REFERENCE_REPOSITORY,'--jq','.full_name']);
const download=async part=>{
 if(localParts){const path=resolve(localParts,part.name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsafe offline snapshot path');const check=await fileHash(path);if(check.sha256!==part.sha256||check.bytes!==part.bytes)throw new Error('Offline database checksum mismatch');return path;}
 const path=resolve(folder,part.name),existing=await lstat(path).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
 if(existing){if(!existing.isFile()||existing.isSymbolicLink())throw new Error('Unsafe snapshot cache path');const check=await fileHash(path);if(check.sha256===part.sha256&&check.bytes===part.bytes)return path;await unlink(path);}
 const temporary=path+'.downloading';const old=await lstat(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(old){if(!old.isFile()||old.isSymbolicLink())throw new Error('Unsafe snapshot download path');await unlink(temporary);}
 console.log('Downloading database part',part.index,'of',manifest.parts.length);
 await command('gh',['release','download',manifest.release,'--repo',REFERENCE_REPOSITORY,'--pattern',part.name,'--output',temporary]);
 const check=await fileHash(temporary);if(check.sha256!==part.sha256||check.bytes!==part.bytes)throw new Error('Downloaded database checksum mismatch: '+part.name);await rename(temporary,path);return path;
};
try{
 if(manifest.objects){
  const inventory=manifest.objects,hash=createHash('sha256');
  async function* objectBytes(){for(const part of inventory.parts){const path=await download(part);for await(const chunk of createReadStream(path)){hash.update(chunk);yield chunk;}if(!localParts)await unlink(path);}if(hash.digest('hex')!==inventory.sha256)throw new Error('Whole object archive checksum mismatch');}
  await unpackObjects(referenceFilesRoot(),inventory.entries,objectBytes());
 }
 const first=await download(manifest.parts[0]);
 const list=spawn('docker',['compose','exec','-T','db','pg_restore','--list'],{stdio:['pipe','pipe','inherit']}),listDone=processDone(list);let toc='';list.stdout.on('data',b=>toc+=b);list.stdin.on('error',()=>{});
 await pipeline(createReadStream(first,{end:1024*1024-1}),list.stdin).catch(e=>{if(!['EPIPE','ERR_STREAM_PREMATURE_CLOSE'].includes(e.code))throw e;});await listDone;assertArchiveInventory(toc,manifest.tables);
 const whole=createHash('sha256');
 async function* bytes(){
  let tail=null;
  for(const part of manifest.parts){const path=await download(part);for await(const chunk of createReadStream(path)){whole.update(chunk);if(tail)yield tail;tail=chunk;}if(!localParts)await unlink(path);console.log('Restoring database part',part.index,'of',manifest.parts.length);}
  // Withhold the archive's final bytes until the whole checksum passes.
  if(whole.digest('hex')!==manifest.sha256)throw new Error('Whole database checksum mismatch');if(tail)yield tail;
 }
 await restoreReferenceStream(bytes(),manifest,{decoder:{file:'docker',args:['compose','exec','-T','db','pg_restore','--data-only','--schema=knowledge','--no-owner','--no-privileges','--disable-triggers','--exit-on-error','--file=-']},sql:{file:'docker',args:[...dockerSqlArgs(database)]}});

 compare(await counts());
 await writeFile(marker,JSON.stringify({state:'ready',database,restoredAt:new Date().toISOString(),snapshot:manifest.sha256,counts:manifest.tables},null,2));
 console.log('Ready PostgreSQL reference database restored and verified; patient records were not imported.');
}catch(error){await writeFile(marker,JSON.stringify({state:'failed',database,snapshot:manifest.sha256,error:error.message})).catch(()=>{});throw error;}
