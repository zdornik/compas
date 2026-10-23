import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {chmod,copyFile,mkdir,mkdtemp,open,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {adminClient,createIsolatedDatabase,dropIsolatedDatabase,isolatedName,pgBinary,run} from './database-tools.mjs';
import {blobPath,verifyBlob,writeBlob} from '../server/reference-files.mjs';
import {REFERENCE_WRITE_LOCK} from '../server/refresh-reference-catalog.mjs';

const MAGIC=Buffer.from('CMPBAK01'),MAX=1024**3;
async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export function secretKey(value){const key=Buffer.from(value.trim(),'base64');if(key.length!==32)throw Error('A 256-bit backup/data key is required');return key;}
const validName=name=>['database.dump','data_key'].includes(name)||/^objects\/[a-f0-9]{64}$/.test(name);
export function validateBackupManifest(manifest,payloadBytes){
  if(manifest?.format!=='compass-private-v1'||manifest.postgres!==17||!Array.isArray(manifest.files)||manifest.files.length<2||manifest.files.length>10000||manifest.files[0]?.name!=='database.dump'||manifest.files[1]?.name!=='data_key')throw Error('Invalid private backup inventory');
  const names=new Set();let total=0;
  for(const file of manifest.files){
    if(!validName(file.name)||names.has(file.name)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>MAX||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid private backup file');
    if(file.name.startsWith('objects/')&&file.name.slice(8)!==file.sha256)throw Error('Reference identity mismatch');
    names.add(file.name);total+=file.bytes;
  }
  if(total!==payloadBytes||total>MAX)throw Error('Private backup size mismatch');
  if(!Array.isArray(manifest.migrations)||!Array.isArray(manifest.tables)||!Array.isArray(manifest.security)||manifest.tables.some(row=>!['public','knowledge'].includes(row.schema)||!/^[a-z][a-z0-9_]*$/.test(row.name)||!/^\d+$/.test(String(row.rows))))throw Error('Invalid database inventory');
  return manifest;
}
async function writeAll(file,chunk){let offset=0;while(offset<chunk.length){const result=await file.write(chunk.subarray(offset));if(!result.bytesWritten)throw Error('Incomplete backup write');offset+=result.bytesWritten;}}
async function readExact(file,length,position){const data=Buffer.alloc(length);let offset=0;while(offset<length){const {bytesRead}=await file.read(data,offset,length-offset,position+offset);if(!bytesRead)throw Error('Truncated private backup');offset+=bytesRead;}return data;}

export async function encryptPrivateBundle(path,manifest,files,key){
  const json=Buffer.from(JSON.stringify(manifest)),size=Buffer.alloc(4);size.writeUInt32BE(json.length);
  if(json.length>1024**2)throw Error('Backup manifest exceeds one MiB');
  validateBackupManifest(manifest,files.reduce((sum,file)=>sum+file.bytes,0));
  const iv=randomBytes(12),header=Buffer.concat([MAGIC,iv]),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
  const output=await open(path,'wx',0o600);
  try{
    await writeAll(output,header);await writeAll(output,cipher.update(Buffer.concat([size,json])));
    for(const file of files)for await(const chunk of createReadStream(file.path))await writeAll(output,cipher.update(chunk));
    await writeAll(output,cipher.final());await writeAll(output,cipher.getAuthTag());await output.sync();
  }catch(error){await output.close();await rm(path,{force:true});throw error;}
  await output.close();
}
export async function decryptPrivateBundle(path,key,directory){
  const source=await open(path,'r');let bytes,header,tag;
  try{bytes=(await source.stat()).size;if(bytes<40||bytes>MAX+2*1024**2)throw Error('Invalid encrypted backup size');header=await readExact(source,20,0);tag=await readExact(source,16,bytes-16);}finally{await source.close();}
  if(!header.subarray(0,8).equals(MAGIC))throw Error('Unknown private backup format');
  const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(8));decipher.setAAD(header);decipher.setAuthTag(tag);
  const plaintext=join(directory,'payload');
  // Authenticate the entire stream before parsing its manifest or touching PostgreSQL.
  await pipeline(createReadStream(path,{start:20,end:bytes-17}),decipher,createWriteStream(plaintext,{flags:'wx',mode:0o600}));
  const file=await open(plaintext,'r');let manifest,length;
  try{length=(await readExact(file,4,0)).readUInt32BE();if(length>1024**2)throw Error('Backup manifest exceeds one MiB');manifest=JSON.parse((await readExact(file,length,4)).toString());validateBackupManifest(manifest,(await file.stat()).size-4-length);}finally{await file.close();}
  let offset=4+length;
  for(const entry of manifest.files){
    const destination=join(directory,entry.name);await mkdir(dirname(destination),{recursive:true,mode:0o700});
    await pipeline(createReadStream(plaintext,{start:offset,end:offset+entry.bytes-1}),createWriteStream(destination,{flags:'wx',mode:0o600}));
    if(await digest(destination)!==entry.sha256)throw Error('Private backup checksum mismatch');offset+=entry.bytes;
  }
  secretKey(await readFile(join(directory,'data_key'),'utf8'));await rm(plaintext);
  return manifest;
}
async function inventory(db,{excludeSessions=false}={}){
  const tables=(await db.query("SELECT schemaname AS schema,tablename AS name FROM pg_tables WHERE schemaname IN ('public','knowledge') ORDER BY schemaname,tablename")).rows;
  for(const table of tables){if(!/^[a-z][a-z0-9_]*$/.test(table.name))throw Error('Unsupported database table name');table.rows=excludeSessions&&table.name==='app_sessions'?'0':(await db.query(`SELECT count(*)::text AS count FROM "${table.schema}"."${table.name}"`)).rows[0].count;}
  const migrations=(await db.query('SELECT id FROM public.schema_migrations ORDER BY id')).rows.map(row=>row.id);
  // Preserve SECURITY DEFINER ownership, ACLs and RLS; --no-owner would weaken the worker boundary.
  const security=(await db.query(`SELECT 'table' kind,n.nspname schema,c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,c.relacl::text acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','knowledge') AND c.relkind IN ('r','p')
    UNION ALL SELECT 'function',n.nspname,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_userbyid(p.proowner),p.prosecdef,false,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','knowledge') ORDER BY kind,schema,name`)).rows;
  return {tables,migrations,security};
}
export async function createPrivateBackup({config,database,dataKeyFile,archive,backupKeyFile,path}){
  const staging=await mkdtemp(join(tmpdir(),'compass-private-backup-')),db=await adminClient(config,database);let committed=false;
  try{
    if(Math.floor(Number((await db.query('SHOW server_version_num')).rows[0].server_version_num)/10000)!==17)throw Error('Backup requires PostgreSQL 17');
    if(Number((await db.query('SELECT pg_database_size(current_database()) bytes')).rows[0].bytes)>MAX)throw Error('Database exceeds the one-GiB local backup limit');
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query('SELECT pg_advisory_xact_lock_shared($1)',[REFERENCE_WRITE_LOCK]);
    const snapshot=(await db.query('SELECT pg_export_snapshot() snapshot,transaction_timestamp() at')).rows[0];
    const objects=(await db.query('SELECT blob_key AS sha256,original_bytes::text AS bytes FROM knowledge.documents WHERE blob_key IS NOT NULL UNION SELECT blob_key,original_bytes::text FROM knowledge.page_assets WHERE blob_key IS NOT NULL ORDER BY sha256')).rows;
    const counts=await inventory(db,{excludeSessions:true}),files=[];
    for(const object of objects)await verifyBlob(archive,object.sha256,Number(object.bytes));
    const env={...process.env,PGHOST:config.host,PGPORT:String(config.port),PGUSER:config.user,PGPASSWORD:config.adminPassword};
    await run(await pgBinary('pg_dump'),['--format=custom','--no-password','--exclude-table-data=public.app_sessions','--snapshot='+snapshot.snapshot,'--file='+join(staging,'database.dump'),database],{env,quiet:true});
    secretKey(await readFile(dataKeyFile,'utf8'));await copyFile(dataKeyFile,join(staging,'data_key'));await chmod(join(staging,'data_key'),0o600);
    for(const name of ['database.dump','data_key'])files.push({name,path:join(staging,name),bytes:(await stat(join(staging,name))).size,sha256:await digest(join(staging,name))});
    for(const object of objects)files.push({name:'objects/'+object.sha256,path:blobPath(archive,object.sha256),bytes:Number(object.bytes),sha256:object.sha256});
    const manifest={format:'compass-private-v1',postgres:17,snapshotAt:snapshot.at.toISOString(),...counts,files:files.map(({path,...value})=>value)};
    await mkdir(dirname(resolve(path)),{recursive:true,mode:0o700});
    await encryptPrivateBundle(path,manifest,files,secretKey(await readFile(backupKeyFile,'utf8')));
    await db.query('COMMIT');committed=true;
    return {encrypted:true,path:resolve(path),bytes:(await stat(path)).size,objects:objects.length,tables:counts.tables.length,snapshotAt:manifest.snapshotAt};
  }finally{if(!committed)await db.query('ROLLBACK').catch(()=>{});await db.end();await rm(staging,{recursive:true,force:true});}
}
export async function restorePrivateBackup({config,path,backupKeyFile,database,directory}){
  if(!isolatedName(database))throw Error('Restore requires a new isolated database name');
  await mkdir(directory,{recursive:false,mode:0o700});let created=false,success=false;
  const staging=await mkdtemp(join(tmpdir(),'compass-private-restore-'));
  try{
    const manifest=await decryptPrivateBundle(path,secretKey(await readFile(backupKeyFile,'utf8')),staging);
    const check=await adminClient(config);
    try{
      if((await check.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rows.length)throw Error('Restore refuses an existing database');
      if(Math.floor(Number((await check.query('SHOW server_version_num')).rows[0].server_version_num)/10000)!==17)throw Error('Restore requires PostgreSQL 17');
      const roles=(await check.query("SELECT rolname FROM pg_roles WHERE rolname IN ('compass_app','compass_admin','compass_journal_worker','compass_journal_service')")).rows;
      if(roles.length!==4)throw Error('Prepare a fresh Compass instance with its own role passwords before restoring');
    }finally{await check.end();}
    await createIsolatedDatabase(config,database);created=true;
    const env={...process.env,PGHOST:config.host,PGPORT:String(config.port),PGUSER:config.user,PGPASSWORD:config.adminPassword};
    await run(await pgBinary('pg_restore'),['--exit-on-error','--single-transaction','--no-password','--dbname='+database,join(staging,'database.dump')],{env,quiet:true});
    const db=await adminClient(config,database);
    try{
      const actual=await inventory(db);
      if(JSON.stringify(actual)!==JSON.stringify({tables:manifest.tables,migrations:manifest.migrations,security:manifest.security}))throw Error('Restored database counts, migrations or security owners differ');
      // Abandoned leases cannot survive a disaster; fencing tokens are discarded.
      await db.query("UPDATE public.journal_analysis_jobs SET state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'retry_wait' END,error_code=CASE WHEN attempts>=4 THEN 'ATTEMPTS_EXHAUSTED' ELSE error_code END,available_at=now(),lease_token=NULL,lease_until=NULL WHERE state='running'");
    }finally{await db.end();}
    await copyFile(join(staging,'data_key'),join(directory,'data_key'));await chmod(join(directory,'data_key'),0o600);
    const archive=join(directory,'blobs');await mkdir(archive,{mode:0o700});
    for(const file of manifest.files.filter(file=>file.name.startsWith('objects/')))await writeBlob(archive,file.sha256,createReadStream(join(staging,file.name)));
    await writeFile(join(directory,'restore.json'),JSON.stringify({database,restoredAt:new Date().toISOString(),snapshotAt:manifest.snapshotAt,objects:manifest.files.length-2},{},2),{mode:0o600});
    success=true;return {database,dataKeyFile:join(directory,'data_key'),archive,objects:manifest.files.length-2,tables:manifest.tables.length};
  }finally{
    await rm(staging,{recursive:true,force:true});
    if(!success){try{if(created)await dropIsolatedDatabase(config,database);}finally{await rm(directory,{recursive:true,force:true});}}
  }
}
