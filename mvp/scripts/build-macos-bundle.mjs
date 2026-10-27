// Allowlisted source + compiled UI + pure-JS runtime deps + ONE verified public sample.
import {mkdir,readdir,readFile,writeFile,copyFile,lstat,chmod,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {root} from './database-tools.mjs';
import {distributionSourcePath,runtimePackages} from './distribution-policy.mjs';
import {blobPath,verifyBlob} from '../server/reference-files.mjs';
const exec=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
const label='compass-macos-demo-'+date,base=resolve(root,'qa/distribution'),stage=join(base,label),zip=join(base,label+'.zip');
await mkdir(base,{recursive:true});
for(const path of [stage,zip]){if(await stat(path).then(()=>true,()=>false))throw Error('Already exists: '+path);}
await new Promise((done,fail)=>{const child=spawn(process.execPath,['--run','build'],{cwd:root,env:{...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH},stdio:'inherit'});child.once('error',fail);child.once('exit',code=>code===0?done():fail(Error('Build failed')));});
await mkdir(stage);
async function copyTree(from,to,path=''){
 const info=await lstat(from);if(!distributionSourcePath(path))return;
 if(info.isSymbolicLink())throw Error('Symlink is not a distribution source: '+path);
 if(info.isDirectory()){
  await mkdir(to,{recursive:true});for(const item of (await readdir(from)).sort())await copyTree(join(from,item),join(to,item),path?path+'/'+item:item);
 }else if(info.isFile()){await mkdir(dirname(to),{recursive:true});await copyFile(from,to);await chmod(to,0o644);}
 else throw Error('Unsupported distribution file: '+path);
}
for(const directory of ['src','server','scripts','docker','tests','public','dist','distribution'])await copyTree(join(root,directory),join(stage,directory),directory);
const documents=['README.md','SECURITY.md','ASSESSMENTS.md','ASSETS.md','ARCHITECTURE.md','JOURNAL.md','APPOINTMENTS.md','HISTORY.md','BACKUP.md','TRACKING.md','PRESENTATION.md','PRESENTATION-HANDOFF.md','PERFORMANCE.md','REFERENCE-PERFORMANCE.md','CHRONIC-CATALOG.md','INGREDIENT-MAPPING.md','DOCTOR-UX.md','REFERENCE-FILES.md','KNOWLEDGE.md','TASKS.md','DEMO-SCRIPT.md'];
for(const file of ['package.json','package-lock.json','index.html','vite.config.mjs','Dockerfile','Dockerfile.knowledge','compose.yaml','compose.demo.yaml','.dockerignore','.gitignore',...documents])await copyTree(join(root,file),join(stage,file),file);
for(const file of await readdir(join(root,'distribution/macos'))){await copyFile(join(root,'distribution/macos',file),join(stage,file));if(file.endsWith('.command'))await chmod(join(stage,file),0o755);}
await copyFile(join(stage,'README.md'),join(stage,'PROJECT-README.md'));
await copyFile(join(stage,'READ-ME-FIRST.md'),join(stage,'README.md'));
const packages=await runtimePackages(root);
for(const pkg of packages)await copyTree(pkg.directory,join(stage,'node_modules',pkg.name),'node_modules/'+pkg.name);
// Preserve licence notices for the runtime and the libraries used by the compiled frontend.
const notices=[];
async function noticesFor(directory){
 const metadata=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
 const id=metadata.name.replaceAll('/','__'),files=(await readdir(directory)).filter(file=>/^(?:licen[sc]e|notice|copying)(?:\.|$)/i.test(file));
 for(const file of files){if((await lstat(join(directory,file))).isFile())await copyTree(join(directory,file),join(stage,'licenses/npm',id,file),'licenses/npm/'+id+'/'+file);}
 notices.push({name:metadata.name,version:metadata.version,license:metadata.license||'See upstream notice',notice:files.join(', ')});
}
for(const item of (await readdir(join(root,'node_modules'))).filter(name=>!name.startsWith('.')).sort()){
 const path=join(root,'node_modules',item);
 for(const candidate of item.startsWith('@')?(await readdir(path)).map(name=>join(path,name)):[path])if(await stat(join(candidate,'package.json')).then(()=>true,()=>false))await noticesFor(candidate);
}
await writeFile(join(stage,'THIRD-PARTY-NOTICES.md'),'# npm dependency notices\n\nRuntime packages are in node_modules. Frontend/build packages are recorded here with their notices in licenses/npm. Full development dependencies can be installed with npm ci.\n\n| Package | Version | License | Notice files |\n|---|---|---|---|\n'+notices.map(row=>`| ${row.name} | ${row.version} | ${typeof row.license==='string'?row.license:JSON.stringify(row.license)} | ${row.notice||'See package source'} |`).join('\n')+'\n');
// The only allowed qa content is this pre-existing public reference sample; never copy a cluster or keys.
const reference=join(root,'qa/presentation/reference'),envelope=JSON.parse(await readFile(join(reference,'sample.json'),'utf8'));
if(sha(envelope.payload)!==envelope.sha256)throw Error('Public sample checksum mismatch');
const sample=JSON.parse(envelope.payload);
if(sample.version!==1||sample.id!=='cr:301_3'||JSON.stringify(Object.keys(sample.tables).sort())!==JSON.stringify(['documents','page_assets','pages','sources'])||sample.tables.documents.length!==1||sample.tables.documents[0].id!==sample.id)throw Error('Not the allowlisted public sample');
await copyTree(join(reference,'sample.json'),join(stage,'qa/presentation/reference/sample.json'),'reference/sample.json');
for(const object of sample.objects){await verifyBlob(join(reference,'blobs'),object.sha256,object.bytes);await copyTree(blobPath(join(reference,'blobs'),object.sha256),blobPath(join(stage,'qa/presentation/reference/blobs'),object.sha256),'reference/'+object.sha256);}
const build=JSON.parse(await readFile(join(stage,'dist/client/build-info.json'),'utf8'));
await writeFile(join(stage,'.compass-bundle.json'),JSON.stringify({version:1,purpose:'compass-macos-demo',syntheticOnly:true,demoPassword:'Compass-Demo-2026!',sourceBuild:build.sourceSha256,createdAt:new Date().toISOString(),systemDependencies:['Node.js >=22','PostgreSQL 17'],runtimePackages:packages.map(({name,version})=>({name,version}))},null,2));
await writeFile(join(stage,'BUNDLE-INFO.md'),`# Комплект ${date}\n\nСборка приложения: ${build.sourceSha256}.\n\nСерверные npm-зависимости включены (${packages.length} пакетов); готовый интерфейс и исходники включены. Системные Node.js/PostgreSQL устанавливаются при первом запуске через Homebrew при необходимости. Полный справочник, приватные БД, ключи и сессии не включены.\n\nПубличный образец: ${sample.id}, ${sample.tables.pages.length} страниц, ${sample.objects.length} файлов. Контрольные суммы всех файлов — BUNDLE-MANIFEST.json.\n`);
const files=[];
async function inventory(directory){for(const name of (await readdir(directory)).sort()){const path=join(directory,name),info=await lstat(path);if(info.isDirectory())await inventory(path);else{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);files.push({path:relative(stage,path).split('\\').join('/'),bytes:info.size,sha256:hash.digest('hex')});}}}
await inventory(stage);await writeFile(join(stage,'BUNDLE-MANIFEST.json'),JSON.stringify({version:1,syntheticOnly:true,files},null,2));
await exec('/usr/bin/zip',['-q','-r','-X',zip,label],{cwd:base,maxBuffer:1024*1024});
const hash=createHash('sha256');for await(const chunk of createReadStream(zip))hash.update(chunk);const digest=hash.digest('hex');
await writeFile(zip+'.sha256',digest+'  '+label+'.zip\n');
console.log(JSON.stringify({archive:zip,staging:stage,bytes:(await stat(zip)).size,sha256:digest,files:files.length+1,runtimePackages:packages.length,build:build.sourceSha256}));
