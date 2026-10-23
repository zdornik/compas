// A private, disposable local PostgreSQL cluster. Never targets the primary cluster.
import {mkdir,readFile,writeFile,chmod,access,unlink,open,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {root,pgBinary,run,adminClient,createIsolatedDatabase,migrateIsolatedDatabase,dropIsolatedDatabase,applyRepositoryMigrations} from './database-tools.mjs';
import {presentationReference} from './presentation-reference.mjs';
import {dayKey} from '../src/domain.js';
import {JOURNAL_POLICY} from '../server/journal-policy.mjs';

const directory=join(root,'qa/presentation'),configFile=join(directory,'instance.json'),pidFile=join(directory,'processes.json');
const exists=async path=>access(path).then(()=>true,()=>false);
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const action=process.argv[2]||'check';
await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
if(!await exists(configFile)){
  if(action!=='prepare')throw Error('First run presentation:prepare');
  const id=randomBytes(6).toString('hex'),config={version:1,id,database:'compass_presentation_'+id,port:4176,pgPort:55434};
  await writeFile(configFile,JSON.stringify(config,null,2),{flag:'wx',mode:0o600});
}
const config=JSON.parse(await readFile(configFile,'utf8'));
if(config.version!==1||!/^[a-f0-9]{12}$/.test(config.id)||config.database!=='compass_presentation_'+config.id||config.port!==4176||config.pgPort!==55434)throw Error('Unexpected presentation instance; refusing to start or reset');
const marker='--instance='+config.id,origin='http://127.0.0.1:'+config.port,data=join(directory,'postgres'),socket=join(directory,'socket'),secrets=join(directory,'secrets');
await mkdir(secrets,{recursive:true,mode:0o700});await mkdir(socket,{recursive:true,mode:0o700});
if(action==='prepare')for(const name of ['admin_db_password','app_db_password','journal_db_password','data_key']){
  if(!await exists(join(secrets,name)))await writeFile(join(secrets,name),randomBytes(32).toString('base64'),{flag:'wx',mode:0o600});
}
const secret=name=>readFile(join(secrets,name),'utf8').then(value=>value.trim());
const database={host:'127.0.0.1',port:config.pgPort,user:'compass_admin',adminPassword:await secret('admin_db_password'),appPassword:await secret('app_db_password'),workerPassword:await secret('journal_db_password')};
const environment={...process.env,DB_HOST:'127.0.0.1',DB_PORT:String(config.pgPort),DB_NAME:config.database,DB_PASSWORD_FILE:join(secrets,'app_db_password'),ADMIN_DB_PASSWORD_FILE:join(secrets,'admin_db_password'),DATA_KEY_FILE:join(secrets,'data_key'),JOURNAL_DB_PASSWORD_FILE:join(secrets,'journal_db_password'),JOURNAL_PROVIDER:'stub',JOURNAL_ANALYSIS_ENABLED:'1',HOST:'127.0.0.1',PORT:String(config.port),SITE_ORIGIN:origin,COMPASS_INSTANCE_ID:config.id,SESSION_COOKIE_NAME:'compass_presentation_'+config.id,REFERENCE_FILES_DIR:join(directory,'reference/blobs')};
const pgctl=await pgBinary('pg_ctl');
async function postgres(){
  if(!await exists(join(data,'PG_VERSION')))throw Error('Presentation database is not initialized');
  if((await readFile(join(data,'PG_VERSION'),'utf8')).trim()!=='17')throw Error('Presentation requires PostgreSQL 17');
  const status=spawnSync(pgctl,['status','-D',data],{stdio:'ignore'});
  if(status.error)throw status.error;
  if(status.status!==0)await run(pgctl,['start','-w','-D',data,'-l',join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${config.pgPort} -k ${quote(socket)}`],{quiet:true});
  const client=await adminClient(database);
  try{if(resolve((await client.query('SHOW data_directory')).rows[0].data_directory)!==resolve(data))throw Error('Port belongs to another PostgreSQL instance');}finally{await client.end();}
}
async function seed(){
  Object.assign(process.env,environment);
  const {createStore}=await import('../server/store.mjs'),store=await createStore();
  const credentials={instance:config.id,database:config.database,syntheticOnly:true,password:randomBytes(18).toString('base64url'),patient:'patient@compass.example.invalid',doctor:'doctor@compass.example.invalid',otherPatient:'other@compass.example.invalid'};
  try{
    const sessions={};
    for(const [name,role] of [['patient','patient'],['doctor','doctor'],['otherPatient','patient']]){
      const value=await store.auth.register({role,email:credentials[name],password:credentials.password,profile:{name:'Тестовый',surname:name==='doctor'?'Врач':name==='patient'?'Пациент':'Другой пациент',...(role==='patient'?{age:30}:{})},consents:{healthData:true}});
      sessions[name]=await store.session(value.token);
    }
    const patient=sessions.patient,doctor=sessions.doctor,care=await store.care.links(patient);
    const link=await store.care.claim(doctor,care.profile.code);await store.care.consent(patient,link.id,'active');
    await store.auth.consents(patient,{healthData:true,journalProcessing:true,journalSharing:true,journalAiProcessing:true,providerPolicyVersion:JOURNAL_POLICY});
    for(let i=13;i>=0;i--){
      const day=dayKey(new Date(Date.now()-i*86400000));
      for(const entry of [{id:randomUUID(),type:'mood',value:2+i%3,words:[],factors:[],note:'',kind:'day',day},{id:randomUUID(),type:'sleep',hours:7,minutes:i%2?30:0,quality:'Хорошо',day}])await store.saveEntry(patient.patient_id,entry.id,entry);
    }
    for(const [title,body] of [['Вымышленный день','Это синтетическая запись для демонстрации сохранения и тестового саммари.'],['Тестовое уведомление','[TEST:elevated] Вымышленная запись для проверки маршрута уведомления.']]){
      const entry={id:randomUUID(),type:'journal',title,body,day:dayKey(),expectedRevision:0,mutationId:randomUUID()};await store.saveEntry(patient.patient_id,entry.id,entry);
    }
    credentials.linkId=link.id;
    await writeFile(join(directory,'accounts.json'),JSON.stringify(credentials,null,2),{mode:0o600});
  }finally{await store.close();}
}
async function processes(){return JSON.parse(await readFile(pidFile,'utf8').catch(()=>'{}'));}
function owned(pid){
  if(!Number.isSafeInteger(pid)||pid<2)return false;
  const result=spawnSync('ps',['-ww','-p',String(pid),'-o','args='],{encoding:'utf8'});
  return result.status===0&&result.stdout.includes(marker)&&result.stdout.includes(root);
}
async function stop(){
  const pids=await processes();
  for(const pid of [pids.controller,pids.web,pids.worker])if(owned(pid))try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  for(let i=0;i<40;i++){if(![pids.controller,pids.web,pids.worker].some(owned))break;await delay(100);}
  if([pids.controller,pids.web,pids.worker].some(owned))throw Error('Presentation processes did not stop; database preserved');
  await unlink(pidFile).catch(()=>{});
}
async function ready(){
  for(let i=0;i<40;i++){
    try{const response=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)});if(response.ok&&(await response.json()).instanceId===config.id)return;}catch{}
    await delay(200);
  }
  throw Error('Presentation web did not become ready; inspect qa/presentation/application.log');
}
async function check(){
  const pids=await processes();
  if(!owned(pids.web)||!owned(pids.worker))throw Error('Presentation web or worker is not running');
  await ready();
  const build=await fetch(origin+'/build-info.json',{signal:AbortSignal.timeout(5000)}).then(response=>response.json());
  const health=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)}).then(response=>response.json());
  if(!/^[a-f0-9]{64}$/.test(build.sourceSha256)||health.buildId!==build.sourceSha256)throw Error('Frontend build and API differ; restart the presentation after rebuilding');
  const credentials=JSON.parse(await readFile(join(directory,'accounts.json'),'utf8'));
  if(credentials.instance!==config.id||credentials.database!==config.database)throw Error('Presentation credentials belong to another instance');
  let csrf;const jar=new Map();
  const request=async(path,body,method=body===undefined?'GET':'POST')=>{
    const response=await fetch(origin+path,{method,signal:AbortSignal.timeout(5000),headers:{Origin:origin,'Content-Type':'application/json','X-Compass-Client':'web','X-Compass-Role':'patient',...(csrf?{'X-CSRF-Token':csrf}:{}),Cookie:[...jar].map(([key,value])=>key+'='+value).join('; ')},...(body===undefined?{}:{body:JSON.stringify(body)})});
    for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';')[0],at=first.indexOf('=');jar.set(first.slice(0,at),first.slice(at+1));}
    const value=await response.json();if(!response.ok)throw Error('Presentation probe failed: '+path+' ('+response.status+')');if(value.csrfToken)csrf=value.csrfToken;return value;
  };
  await request('/api/session',{});await request('/api/auth/login',{role:'patient',email:credentials.patient,password:credentials.password});
  const started=Date.now(),id=randomUUID();
  await request('/api/entries/'+id,{id,type:'journal',title:'Проверка готовности стенда',body:'Синтетическая проверка очереди перед презентацией.',day:dayKey(),expectedRevision:0,mutationId:randomUUID()},'PUT');
  let processed=false;
  while(Date.now()-started<10000){const result=await request('/api/journal/'+id+'/analysis');if(result.analysis.status==='succeeded'){processed=true;break;}if(result.analysis.status==='failed')break;await delay(250);}
  if(!processed)throw Error('Web is available but the presentation worker did not process a probe within 10 seconds');
  const client=await adminClient(database,config.database);
  try{
    const migrations=(await client.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map(row=>row.id);
    const expected=(await readdir(join(root,'docker/migrations'))).filter(name=>/^\d{3}-.*\.sql$/.test(name)).map(name=>name.slice(0,-4)).sort();
    if(JSON.stringify(migrations)!==JSON.stringify(expected))throw Error('Presentation schema does not match this repository');
    if(await exists(join(directory,'reference/sample.json'))){
      await presentationReferenceCheck();
      if(!(await client.query("SELECT 1 FROM knowledge.reader_indexes i JOIN knowledge.documents d ON d.id=i.document_id AND d.sha256=i.source_sha256 WHERE d.id='cr:301_3'")).rows.length)throw Error('Official sample or reader index is missing');
    }
    const counts=(await client.query('SELECT (SELECT count(*)::int FROM knowledge.documents) documents,(SELECT count(*)::int FROM knowledge.products) products')).rows[0];
    console.log(JSON.stringify({ready:true,origin,build:build.sourceSha256,syntheticOnly:true,provider:'stub',workerProbeMs:Date.now()-started,migrations,reference:counts}));
  }finally{await client.end();}
}

if(action==='prepare'){
  if(!await exists(join(data,'PG_VERSION')))await run(await pgBinary('initdb'),['-D',data,'-U','compass_admin','--pwfile='+join(secrets,'admin_db_password'),'--auth-local=scram-sha-256','--auth-host=scram-sha-256','--encoding=UTF8','--no-locale'],{quiet:true});
  await postgres();const client=await adminClient(database);let present;
  try{present=(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[config.database])).rows.length;}finally{await client.end();}
  if(!present){await createIsolatedDatabase(database,config.database);await migrateIsolatedDatabase(database,config.database);await seed();}
  else{if(!await exists(join(directory,'accounts.json')))throw Error('Incomplete preparation; use presentation:reset to recreate only this isolated database');await applyRepositoryMigrations(database,config.database);}
  console.log('Presentation prepared. Credentials: qa/presentation/accounts.json. Reference catalog is empty unless a sample is imported.');
}else if(action==='start'){
  await postgres();if(!await exists(join(directory,'accounts.json')))throw Error('Run presentation:prepare before starting');
  if(!await exists(join(root,'dist/client/index.html')))throw Error('Build the application before presentation:start');
  if(process.argv.includes(marker)){
    const web=spawn(process.execPath,[join(root,'scripts/serve.mjs'),marker],{cwd:root,env:environment,stdio:'inherit'});
    const worker=spawn(process.execPath,[join(root,'scripts/run-journal-worker.mjs'),marker],{cwd:root,env:environment,stdio:'inherit'});
    await writeFile(pidFile,JSON.stringify({controller:process.pid,web:web.pid,worker:worker.pid}),{mode:0o600});
    let stopping=false;
    const shutdown=()=>{if(stopping)return;stopping=true;web.kill('SIGTERM');worker.kill('SIGTERM');};
    process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
    for(const child of [web,worker])child.once('exit',shutdown);
    await Promise.all([web,worker].map(child=>new Promise(resolve=>child.once('close',resolve))));
  }else{
    const current=await processes();
    if(!owned(current.controller)){
      await stop();const log=await open(join(directory,'application.log'),'a',0o600);
      try{const child=spawn(process.execPath,[join(root,'scripts/presentation.mjs'),'start',marker],{cwd:root,env:process.env,stdio:['ignore',log.fd,log.fd],detached:true});child.unref();}finally{await log.close();}
    }
    await ready();console.log('Presentation: '+origin+' (synthetic accounts; local stub).');
  }
}else if(action==='check'){await postgres();await check();}
else if(action==='reference'){await postgres();console.log(JSON.stringify(await presentationReference({config:database,database:config.database,directory,fromLocal:process.argv.includes('--from-local-reference')})));}
else if(action==='stop'){await stop();if(await exists(join(data,'PG_VERSION')))await run(pgctl,['stop','-w','-D',data,'-m','fast'],{quiet:true});console.log('Presentation stopped; data preserved.');}
else if(action==='reset'){
  await stop();await postgres();await dropIsolatedDatabase(database,config.database);await createIsolatedDatabase(database,config.database);await migrateIsolatedDatabase(database,config.database);await seed();
  if(await exists(join(directory,'reference/sample.json')))await presentationReference({config:database,database:config.database,directory});
  console.log('Only the isolated presentation database was reset. Run presentation:start.');
}else throw Error('Use prepare, start, check, stop, reset or reference');

async function presentationReferenceCheck(){
  const {verifyBlob}=await import('../server/reference-files.mjs');
  const {createHash}=await import('node:crypto');
  const envelope=JSON.parse(await readFile(join(directory,'reference/sample.json'),'utf8'));
  if(createHash('sha256').update(envelope.payload).digest('hex')!==envelope.sha256)throw Error('Reference sample checksum mismatch');
  for(const object of JSON.parse(envelope.payload).objects)await verifyBlob(join(directory,'reference/blobs'),object.sha256,object.bytes);
}
