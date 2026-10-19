import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateSnapshot,assertArchiveInventory,command,fileHash} from '../scripts/reference-snapshot.mjs';
const valid=()=>({format:'postgresql-custom-data-v1',state:'ready',repository:'zdornik/compas',release:'reference-db-qa',schema:'knowledge',containsPatientData:false,containsSecrets:false,sha256:'a'.repeat(64),bytes:30,tables:{sources:1,documents:2},requiredMigrations:['002-knowledge'],excludedTables:['catalog_state'],parts:[{index:1,name:'reference-db-qa.part-0001',bytes:10,sha256:'b'.repeat(64),assetId:101},{index:2,name:'reference-db-qa.part-0002',bytes:20,sha256:'c'.repeat(64),assetId:102}]});
test('reference snapshot accepts a complete ordered private-repository database inventory',()=>{assert.equal(validateSnapshot(valid()).parts.length,2);});
test('reference snapshot rejects patient schemas, secrets, path traversal, reordered parts and inconsistent sizes',()=>{
 for(const change of [{schema:'public'},{containsPatientData:true},{containsSecrets:true},{repository:'other/repo'},{tables:{auth_accounts:2}},{bytes:31},{requiredMigrations:[]},{excludedTables:[]}])assert.throws(()=>validateSnapshot({...valid(),...change}));
 for(const change of [{name:'../data.part-0001'},{index:2},{bytes:0},{sha256:'wrong'},{assetId:0},{name:'reference-db-qa.part-0002'}]){const m=valid();m.parts[0]={...m.parts[0],...change};assert.throws(()=>validateSnapshot(m));}
});
test('the archive must contain exactly the declared public reference table data and no functions or account data',()=>{
 const toc='; Archive\n1; 0 1 TABLE DATA knowledge sources compass_admin\n2; 0 2 TABLE DATA knowledge documents compass_admin\n';
 assert.deepEqual(assertArchiveInventory(toc,{sources:1,documents:2}),['documents','sources']);
 for(const broken of [toc.replace('knowledge sources','public auth_accounts'),toc.replace('TABLE DATA knowledge documents','FUNCTION knowledge documents'),toc.split('\n').slice(0,2).join('\n'),toc+toc.split('\n')[1]])assert.throws(()=>assertArchiveInventory(broken,{sources:1,documents:2}));
});
test('the process helper closes its input before awaiting captured output and reports failures',async()=>{
 assert.equal(await command(process.execPath,['-e',"let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(s.toUpperCase()))"],{input:'reference-fixture'}),'REFERENCE-FIXTURE');
 await assert.rejects(()=>command(process.execPath,['-e','process.exit(7)']));
});
test('snapshot file checks detect changed bytes before database restore',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'compass-reference-hash-'));try{const file=join(folder,'part');await writeFile(file,'reference data');const before=await fileHash(file);await writeFile(file,'Reference data');const after=await fileHash(file);assert.equal(before.bytes,after.bytes);assert.notEqual(before.sha256,after.sha256);}finally{await rm(folder,{recursive:true,force:true});}
});
