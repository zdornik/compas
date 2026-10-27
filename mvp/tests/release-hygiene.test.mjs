import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {blockedReleasePath,verifyProductBuild} from '../scripts/release-policy.mjs';
test('release rejects tooling instructions, private material and generated QA artifacts',()=>{
 for(const path of ['mvp/AGENTS.md','mvp/distribution/AGENT-README.md','.openai/hosting.json','mvp/qa/screenshot.png','mvp/.local-secrets/data_key','credentials.json','.env','private.pem','bundle.zip','mvp/dist/index.html','mvp/backups/data.cpbak','data_key','.npmrc'])assert.equal(blockedReleasePath(path),true,path);
 for(const path of ['README.md','CONTRIBUTING.md','.github/workflows/checks.yml','mvp/SECURITY.md','mvp/ROADMAP.md','mvp/src/JournalEditor.jsx','mvp/docker/migrations/021-care-tracking.sql','mvp/distribution/macos/DEVELOPER-README.md','.env.example'])assert.equal(blockedReleasePath(path),false,path);
});
test('product output rejects obsolete siblings instead of silently shipping them',async()=>{
 const root=await mkdtemp(join(tmpdir(),'compass-release-build-'));
 try{
  await mkdir(join(root,'client'));for(const name of ['index.html','build-info.json','manifest.webmanifest'])await writeFile(join(root,'client',name),'test');
  assert.equal(await verifyProductBuild(root),true);await writeFile(join(root,'client','data_key'),'test');await assert.rejects(()=>verifyProductBuild(root),/service artifact/);await unlink(join(root,'client','data_key'));
  await mkdir(join(root,'server'));await assert.rejects(()=>verifyProductBuild(root),/non-product/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('the built application is a complete product bundle',async()=>{assert.equal(await verifyProductBuild(fileURLToPath(new URL('../dist',import.meta.url))),true);});
