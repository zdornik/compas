import {execFileSync} from 'node:child_process';
import {readFile,access,readdir} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {blockedReleasePath,verifyProductBuild} from './release-policy.mjs';
const root=resolve(import.meta.dirname,'..'),failures=[];
let repository=null,files=[];
try{
 repository=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 if(resolve(repository,'mvp')!==root)repository=null;
 if(repository)files=execFileSync('git',['ls-files','-z'],{cwd:repository}).toString().split('\0').filter(Boolean);
}catch{}
if(!repository&&process.argv.includes('--require-git'))throw Error('A checkout of the product repository is required');
if(repository)for(const file of files)if(blockedReleasePath(file))failures.push('Non-product tracked file: '+file);
// Check only distributable Markdown; runtime data and generated reports are deliberately excluded.
let documents=[];
if(repository)documents=files.filter(file=>file.endsWith('.md')).map(file=>join(repository,file));
else{
 const walk=async directory=>{for(const entry of await readdir(directory,{withFileTypes:true})){if(['node_modules','dist','qa','.git','.local-secrets','.demo-secrets'].includes(entry.name))continue;const path=join(directory,entry.name);if(entry.isDirectory())await walk(path);else if(entry.name.endsWith('.md'))documents.push(path);}};
 await walk(root);
}
for(const file of documents){
 let text;try{text=await readFile(file,'utf8');}catch{continue;}
 text=text.replace(/```[\s\S]*?```/g,'');
 for(const match of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)){
  let target=match[1].trim().replace(/^<|>$/g,'').split(/\s+["']/)[0];
  if(/^(?:[a-z]+:|#|\/)/i.test(target)||target.includes('://'))continue;
  target=target.split('#')[0];if(!target)continue;
  try{target=decodeURIComponent(target);}catch{failures.push('Malformed documentation link in '+file);continue;}
  if(isAbsolute(target))continue;
  if(/(?:^|\/)(?:qa|dist|node_modules|backups|raw|processed|archive)(?:\/|$)/.test(target))continue;
  if(!await access(resolve(dirname(file),target)).then(()=>true,()=>false))failures.push('Missing documentation target: '+file+' -> '+target);
 }
}
if(process.argv.includes('--build'))await verifyProductBuild(join(root,'dist'));
if(failures.length)throw Error(failures.join('\n'));
console.log(JSON.stringify({passed:true,trackedFiles:repository?files.length:null,documents:documents.length,buildChecked:process.argv.includes('--build')}));
