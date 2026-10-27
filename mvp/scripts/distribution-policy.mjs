import {createRequire} from 'node:module';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
const forbidden=new Set(['.git','.DS_Store','.local-secrets','.demo-secrets','.aws','__pycache__','backups']);
export function distributionSourcePath(path){
 const parts=path.replaceAll('\\','/').split('/');
 return !parts.some(part=>part==='..'||(part.startsWith('.')&&!['.dockerignore','.gitignore','.env.example'].includes(part))||forbidden.has(part)||part==='.env'||part.startsWith('.env.')||part.endsWith('.log')||part.endsWith('.pid')||part.endsWith('.pyc'));
}
export async function runtimePackages(root){
 const base=await realpath(resolve(root,'node_modules')),found=new Map();
 async function visit(name,from=resolve(root,'package.json')){
  if(found.has(name))return;
  const req=createRequire(from);let file;
  try{file=req.resolve(name+'/package.json');}catch{
   let location=dirname(req.resolve(name));
   for(;;){try{const value=JSON.parse(await readFile(resolve(location,'package.json'),'utf8'));if(value.name===name){file=resolve(location,'package.json');break;}}catch{}const parent=dirname(location);if(parent===location)throw Error('Cannot resolve runtime dependency '+name);location=parent;}
  }
  const directory=await realpath(dirname(file)),info=await lstat(dirname(file));
  if(info.isSymbolicLink()||!directory.startsWith(base+sep))throw Error('Runtime dependency outside node_modules');
  const pkg=JSON.parse(await readFile(file,'utf8'));found.set(name,{name,version:pkg.version,directory,license:pkg.license||'See LICENSE'});
  for(const dep of Object.keys(pkg.dependencies||{}))await visit(dep,file);
  for(const dep of Object.keys(pkg.optionalDependencies||{})){try{req.resolve(dep);await visit(dep,file);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}}
 }
 await visit('pg');return [...found.values()].sort((a,b)=>a.name.localeCompare(b.name,'en'));
}
