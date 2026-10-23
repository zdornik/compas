import {randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {databaseConfig,createIsolatedDatabase,migrateIsolatedDatabase,dropIsolatedDatabase,run} from './database-tools.mjs';

const rehearsal=process.argv.includes('--rehearsal'),video=process.argv.includes('--video'),browser=rehearsal||video||process.argv.includes('--browser');
const database='compass_journal_qa_'+randomBytes(6).toString('hex');
const config=await databaseConfig(),secrets=await mkdtemp(join(tmpdir(),'compass-integration-'));
let created=false;
try{
  const env={...process.env,DB_HOST:config.host,DB_PORT:String(config.port),DB_NAME:database,JOURNAL_ANALYSIS_ENABLED:'1',JOURNAL_PROVIDER:'stub',BROWSER_REHEARSAL:rehearsal?'1':'0',BROWSER_VIDEO:video?'1':'0'};
  for(const [name,value,variable] of [['admin',config.adminPassword,'ADMIN_DB_PASSWORD_FILE'],['app',config.appPassword,'DB_PASSWORD_FILE'],['worker',config.workerPassword,'JOURNAL_DB_PASSWORD_FILE'],['key',randomBytes(32).toString('base64'),'DATA_KEY_FILE']]){
    const path=join(secrets,name);await writeFile(path,value,{mode:0o600});env[variable]=path;
  }
  await createIsolatedDatabase(config,database);created=true;
  await migrateIsolatedDatabase(config,database);
  console.log('Fresh isolated schema migrated; only synthetic test accounts will be used.');
  for(const script of (browser?['check-browser.mjs']:process.argv.includes('--backup')?['check-backup.mjs']:['check-journal.mjs','check-appointments.mjs','check-history.mjs','check-backup.mjs']))await run(process.execPath,['scripts/'+script],{env,timeout:rehearsal?1500000:browser?240000:120000});
  console.log('PostgreSQL integration checks passed.');
}finally{
  try{if(created)await dropIsolatedDatabase(config,database);}finally{await rm(secrets,{recursive:true,force:true});}
}
