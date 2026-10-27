import {access,readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import pg from 'pg';

export const root=resolve(import.meta.dirname,'..');
export const isolatedName=name=>/^compass_(?:journal_qa|presentation)_[a-f0-9]{8,32}$/.test(name);
export async function pgBinary(name){
  if(process.env.PG_BIN)return join(process.env.PG_BIN,name);
  for(const directory of ['/opt/homebrew/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin']){
    try{await access(join(directory,name));return join(directory,name);}catch{}
  }
  return name;
}
export async function run(file,args,{env=process.env,input,quiet=false,timeout=120000}={}){
  const child=spawn(file,args,{cwd:root,env,stdio:['pipe',quiet?'ignore':'inherit','inherit'],timeout});
  child.stdin.on('error',()=>{});child.stdin.end(input);
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error('Process failed: '+file.split('/').at(-1)+' ('+(code??signal)+')')));});
}
export async function databaseConfig(env=process.env){
  const read=async(variable,fallback)=>env[variable]||(await readFile(resolve(root,env[variable+'_FILE']||fallback),'utf8')).trim();
  return {host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||5432),user:'compass_admin',
    adminPassword:await read('ADMIN_DB_PASSWORD','.local-secrets/admin_db_password'),
    appPassword:await read('DB_PASSWORD','.local-secrets/app_db_password'),
    workerPassword:await read('JOURNAL_DB_PASSWORD','.local-secrets/journal_db_password')};
}
export async function adminClient(config,database='postgres'){
  const client=new pg.Client({host:config.host,port:config.port,user:config.user,database,password:config.adminPassword,connectionTimeoutMillis:5000});
  await client.connect();return client;
}
export async function createIsolatedDatabase(config,name){
  if(!isolatedName(name))throw Error('Refusing a non-isolated database name');
  const client=await adminClient(config);
  try{
    await verifyExistingRolePasswords(config,client);
    await client.query('CREATE DATABASE "'+name+'"');
  }finally{await client.end();}
}
async function verifyExistingRolePasswords(config,client){
  for(const [user,password] of [['compass_app',config.appPassword],['compass_journal_worker',config.workerPassword]]){
      if((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[user])).rows.length){
        const role=new pg.Client({host:config.host,port:config.port,user,password,database:'postgres',connectionTimeoutMillis:5000});
        try{await role.connect();}finally{await role.end();}
      }
    }
}
async function withMigrationLock(config,callback){
  // Role catalogues are cluster-wide, unlike schema locks inside each QA database.
  const lock=await adminClient(config);
  try{await lock.query('SELECT pg_advisory_lock(20261024,1701)');await verifyExistingRolePasswords(config,lock);return await callback();}
  finally{await lock.query('SELECT pg_advisory_unlock(20261024,1701)').catch(()=>{});await lock.end();}
}
export async function migrateIsolatedDatabase(config,name,{through=Infinity}={}){
  if(!isolatedName(name))throw Error('Refusing a non-isolated database name');
  if(through!==Infinity&&(!Number.isSafeInteger(through)||through<1||through>999))throw Error('Invalid migration boundary');
  return withMigrationLock(config,async()=>{
  const env={...process.env,PGHOST:config.host,PGPORT:String(config.port),PGUSER:config.user,PGPASSWORD:config.adminPassword,COMPASS_APP_PASSWORD:config.appPassword,COMPASS_JOURNAL_PASSWORD:config.workerPassword};
  const psql=await pgBinary('psql'),args=['-X','-q','-v','ON_ERROR_STOP=1','-d',name];
  const schema=(await readFile(join(root,'docker/schema.sql'),'utf8')).split('\n');
  if(!schema[0].startsWith('\\set app_password ')||!schema[1].startsWith('CREATE ROLE compass_app '))throw Error('Unexpected base schema: update the isolated migration runner');
  const role=`\\getenv app_password COMPASS_APP_PASSWORD
SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='compass_app') AS missing_app_role \\gset
\\if :missing_app_role
${schema[1]}
\\endif
`;
  await run(psql,args,{env,input:role+schema.slice(2).join('\n'),quiet:true});
  await applyMigrationFiles(config,name,through);
  });
}
export async function applyRepositoryMigrations(config,name){
  if(!isolatedName(name))throw Error('Refusing a non-isolated database name');
  return withMigrationLock(config,()=>applyMigrationFiles(config,name));
}
async function applyMigrationFiles(config,name,through=Infinity){
  const env={...process.env,PGHOST:config.host,PGPORT:String(config.port),PGUSER:config.user,PGPASSWORD:config.adminPassword,COMPASS_JOURNAL_PASSWORD:config.workerPassword};
  const psql=await pgBinary('psql'),args=['-X','-q','-v','ON_ERROR_STOP=1','-d',name];
  for(const filename of (await readdir(join(root,'docker/migrations'))).filter(file=>/^\d{3}-.*\.sql$/.test(file)&&Number(file.slice(0,3))<=through).sort()){
    await run(psql,[...args,'-f',join(root,'docker/migrations',filename)],{env,quiet:true});
  }
}
export async function dropIsolatedDatabase(config,name){
  if(!isolatedName(name))throw Error('Refusing a non-isolated database name');
  const client=await adminClient(config);
  try{await client.query('DROP DATABASE "'+name+'"');}finally{await client.end();}
}
