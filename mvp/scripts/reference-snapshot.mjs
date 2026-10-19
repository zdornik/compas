import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
export const REFERENCE_REPOSITORY='zdornik/compas';
export const HASH=/^[a-f0-9]{64}$/;
export const IDENTIFIER=/^[a-z][a-z0-9_]*$/;
export function processDone(child){const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>code===0?resolve():reject(new Error(`Process failed (${code??signal})`)));});done.catch(()=>{});return done;}
export async function command(file,args,{input,capture=true,...options}={}){
 const child=spawn(file,args,{stdio:[input===undefined?'ignore':'pipe',capture?'pipe':'inherit','inherit'],...options}),done=processDone(child);let output='';
 if(input!==undefined){child.stdin.on('error',()=>{});child.stdin.end(input);}
 if(capture)for await(const chunk of child.stdout){output+=chunk;if(output.length>8*1024*1024){child.kill();throw new Error('Unexpected command output size');}}
 await done;return output.trim();
}
export async function fileHash(path){const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path)){hash.update(chunk);bytes+=chunk.length;}return {sha256:hash.digest('hex'),bytes};}
export function validateSnapshot(value){
 if(value?.format!=='postgresql-custom-data-v1'||value.repository!==REFERENCE_REPOSITORY||value.schema!=='knowledge'||value.containsPatientData!==false||value.containsSecrets!==false||value.state!=='ready'||!HASH.test(value.sha256)||!/^reference-db-[a-zA-Z0-9._-]+$/.test(value.release))throw new Error('Invalid reference snapshot manifest');
 if(!Array.isArray(value.parts)||!value.parts.length||value.parts.length>1000)throw new Error('Invalid snapshot parts');
 let total=0;const names=new Set();for(const [i,p]of value.parts.entries()){
  if(p.index!==i+1||!/^reference-db-[a-zA-Z0-9._-]+\.part-\d{4}$/.test(p.name)||names.has(p.name)||!p.name.endsWith('.part-'+String(i+1).padStart(4,'0'))||!Number.isSafeInteger(p.assetId)||p.assetId<1||!HASH.test(p.sha256)||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>=2*1024**3)throw new Error('Invalid snapshot part');
  names.add(p.name);total+=p.bytes;
 }
 if(!Array.isArray(value.requiredMigrations)||!value.requiredMigrations.length||value.requiredMigrations.some(id=>typeof id!=='string'||!/^\d{3}-[a-z0-9-]+$/.test(id))||JSON.stringify(value.excludedTables)!==JSON.stringify(['catalog_state']))throw new Error('Invalid snapshot schema version');
 if(total!==value.bytes||!value.tables||!Object.keys(value.tables).length||Object.keys(value.tables).some(t=>!IDENTIFIER.test(t)||/(?:patient|auth|session|care_|chat)/.test(t)))throw new Error('Invalid snapshot inventory');
 if(Object.values(value.tables).some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('Invalid snapshot row counts');return value;
}
export const dockerSqlArgs=(database='compass')=>['compose','exec','-T','db','psql','-XAtq','-v','ON_ERROR_STOP=1','-U','compass_admin','-d',database];
export async function sql(statement,{database='compass'}={}){return command('docker',[...dockerSqlArgs(database),'-c',statement]);}
export function assertArchiveInventory(toc,tables){
 const found=[];for(const line of toc.split('\n')){
  if(!line.trim()||line.startsWith(';'))continue;
  const match=line.match(/^\d+; \d+ \d+ TABLE DATA knowledge ([a-z][a-z0-9_]*) /);
  if(!match||!Object.hasOwn(tables,match[1]))throw new Error('Archive contains an unexpected object');found.push(match[1]);
 }
 if(found.length!==new Set(found).size||JSON.stringify(found.sort())!==JSON.stringify(Object.keys(tables).sort()))throw new Error('Archive table inventory is incomplete');
 return found;
}
