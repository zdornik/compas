import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const hash=createHash('sha256');
async function collect(directory){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const path=join(directory,entry.name);
    if(entry.isDirectory())await collect(path);
    else if(/\.(?:mjs|js|jsx|css|sql|json|py)$/.test(path)){hash.update(path+'\0');hash.update(await readFile(path));hash.update('\0');}
  }
}
for(const directory of ['src','server','scripts','docker'])await collect(directory);
for(const file of ['package.json','package-lock.json','vite.config.mjs','Dockerfile','compose.yaml']){hash.update(file+'\0');hash.update(await readFile(file));hash.update('\0');}
let revision=null;
try{revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
const sourceSha256=hash.digest('hex');
await writeFile('dist/client/build-info.json',JSON.stringify({revision,sourceSha256,builtAt:new Date().toISOString()}));
console.log('Build fingerprint: '+sourceSha256.slice(0,12));
