import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {encryptPrivateBundle,decryptPrivateBundle,validateBackupManifest,secretKey} from '../scripts/private-backup.mjs';
test('private backup authenticates data and wrapped data key before parsing or restoration',async()=>{
  const root=await mkdtemp(join(tmpdir(),'compass-backup-unit-'));
  try{
    const key=randomBytes(32),files=[];
    for(const [name,value] of [['database.dump','SYNTHETIC_PRIVATE_BACKUP_CANARY'],['data_key',randomBytes(32).toString('base64')]]){
      const path=join(root,name);await writeFile(path,value,{mode:0o600});files.push({name,path,bytes:Buffer.byteLength(value),sha256:createHash('sha256').update(value).digest('hex')});
    }
    const manifest={format:'compass-private-v1',postgres:17,tables:[],security:[],migrations:[],files:files.map(({path,...file})=>file)},path=join(root,'backup.cpbak');
    await encryptPrivateBundle(path,manifest,files,key);const encrypted=await readFile(path);
    assert.ok(!encrypted.includes('SYNTHETIC_PRIVATE_BACKUP_CANARY'));assert.equal((await stat(path)).mode&0o777,0o600);
    for(const [name,wrongKey,bytes] of [['wrong-key',randomBytes(32),encrypted],['changed',key,Buffer.from(encrypted)],['truncated',key,encrypted.subarray(0,-1)]]){
      const directory=join(root,name);await mkdir(directory);if(name==='changed')bytes[50]^=1;const bad=join(root,name+'.cpbak');await writeFile(bad,bytes);
      await assert.rejects(()=>decryptPrivateBundle(bad,wrongKey,directory));await assert.rejects(()=>stat(join(directory,'database.dump')),{code:'ENOENT'});
    }
    const restored=join(root,'restored');await mkdir(restored);assert.deepEqual(await decryptPrivateBundle(path,key,restored),manifest);
    assert.equal(await readFile(join(restored,'database.dump'),'utf8'),'SYNTHETIC_PRIVATE_BACKUP_CANARY');assert.equal(secretKey(await readFile(join(restored,'data_key'),'utf8')).length,32);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('private backup rejects traversal, duplicate files, missing keys and oversized inventories',()=>{
  const file={name:'database.dump',bytes:1,sha256:'a'.repeat(64)},key={...file,name:'data_key'},base={format:'compass-private-v1',postgres:17,tables:[],security:[],migrations:[],files:[file,key]};
  assert.equal(validateBackupManifest(base,2),base);
  for(const files of [[file],[file,key,{...file,name:'../outside'}],[file,key,key],[file,{...key,bytes:-1}],[file,{...key,sha256:'invalid'}]])assert.throws(()=>validateBackupManifest({...base,files},2));
  assert.throws(()=>validateBackupManifest(base,3));assert.throws(()=>secretKey('wrong'));
});
