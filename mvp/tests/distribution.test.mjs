import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {distributionSourcePath,runtimePackages} from '../scripts/distribution-policy.mjs';
import {bundleAccountPassword} from '../scripts/presentation-fixture.mjs';
test('distribution rejects secrets, sessions metadata, traversal and private working files',()=>{
 for(const path of ['.local-secrets/data_key','nested/.demo-secrets/password','server/.env','server/.env.local','backups/private.cpbak','scripts/application.log','qa/presentation/web.pid','.git/config','src/../.local-secrets/key','.DS_Store'])assert.equal(distributionSourcePath(path),false,path);
 for(const path of ['src/tracking.js','server/api.mjs','scripts/presentation.mjs','docker/migrations/021-care-tracking.sql'])assert.equal(distributionSourcePath(path),true,path);
});
test('runtime dependency inventory includes the complete pg dependency graph from this project',async()=>{
 const packages=await runtimePackages(resolve(import.meta.dirname,'..'));
 assert.ok(packages.some(pkg=>pkg.name==='pg'&&pkg.version==='8.23.1'));
 assert.ok(packages.some(pkg=>pkg.name==='pg-protocol'));
 assert.ok(packages.some(pkg=>pkg.name==='postgres-date'));
 assert.equal(new Set(packages.map(pkg=>pkg.name)).size,packages.length);
 assert.ok(!packages.some(pkg=>['vite','playwright','pg-native'].includes(pkg.name)));
});
test('fixed demo accounts require an explicit synthetic bundle manifest',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'compass-bundle-policy-')),path=join(directory,'manifest.json');
 try{
  for(const value of [{},{version:1,purpose:'compass-macos-demo',syntheticOnly:false,demoPassword:'test-password-2026'},{version:1,purpose:'production',syntheticOnly:true,demoPassword:'test-password-2026'},{version:1,purpose:'compass-macos-demo',syntheticOnly:true,demoPassword:'short'}]){await writeFile(path,JSON.stringify(value));await assert.rejects(()=>bundleAccountPassword(path),/Invalid synthetic/);}
  await writeFile(path,JSON.stringify({version:1,purpose:'compass-macos-demo',syntheticOnly:true,demoPassword:'test-password-2026'}));assert.equal(await bundleAccountPassword(path),'test-password-2026');
 }finally{await rm(directory,{recursive:true,force:true});}
});
