import {access,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
const tooling=/^(?:AGENTS?\.md|AGENT[-_].*\.md|CLAUDE\.md|GEMINI\.md|copilot-instructions\.md|\.DS_Store)$/i;
const privateFolders=new Set(['qa','node_modules','dist','backups','exports','.codex','.agents','.openai','.claude','.cursor','.aws','.local-secrets','.demo-secrets']);
export function privateReleaseFile(name){
 return tooling.test(name)||(/^\.env(?:\.|$)/.test(name)&&name!=='.env.example')||/\.(?:pem|key|p12|pfx|cpbak|dump|backup|sqlite3?|db|log|pid)$/i.test(name)||/^(?:id_rsa|id_ed25519|credentials\.json|accounts\.json|data_key|backup_key|admin_db_password|app_db_password|journal_db_password|\.pgpass|\.npmrc)$/i.test(name);
}
export function blockedReleasePath(path){
 const parts=path.replaceAll('\\','/').split('/'),name=parts.at(-1);
 return parts.some(part=>part==='..'||privateFolders.has(part))||privateReleaseFile(name)||/\.(?:zip|tar|tgz|gz)$/i.test(name);
}
export async function verifyProductBuild(directory){
 for(const file of ['client/index.html','client/build-info.json','client/manifest.webmanifest'])await access(join(directory,file));
 const roots=await readdir(directory);if(roots.some(name=>name!=='client'))throw Error('Build has non-product directories: '+roots.filter(name=>name!=='client').join(', '));
 async function visit(path){for(const name of await readdir(path)){const file=join(path,name),info=await lstat(file);if(info.isSymbolicLink())throw Error('Build contains a symlink');if(privateReleaseFile(name)||privateFolders.has(name))throw Error('Build contains a service artifact: '+name);if(info.isDirectory())await visit(file);}}
 await visit(join(directory,'client'));return true;
}
