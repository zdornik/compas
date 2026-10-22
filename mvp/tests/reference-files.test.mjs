import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Writable} from 'node:stream';
import {gunzipSync} from 'node:zlib';
import {writeBlob,verifyBlob,blobPath,parseByteRange,deliverReferenceFile,matchesEtag} from '../server/reference-files.mjs';
import {packObjects,unpackObjects,validateObjects} from '../scripts/reference-objects.mjs';
import {buildReaderIndex,referenceJson} from '../server/reference-reader.mjs';
import {validateSnapshot} from '../scripts/reference-snapshot.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const response=()=>{const chunks=[];const res=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}});res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;res.headersSent=true;};res.bytes=()=>Buffer.concat(chunks);return res;};
test('reference objects are atomic, deduplicated and verified before a database reference can be published',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reference-files-')),bytes=Buffer.from('%PDF-\noriginal bytes'),key=hash(bytes);
 try{
  assert.equal((await writeBlob(root,key,[bytes])).bytes,bytes.length);await writeBlob(root,key,[bytes]);
  assert.deepEqual(await readFile(blobPath(root,key)),bytes);
  await assert.rejects(writeBlob(root,hash(Buffer.from('different')),[bytes]),/checksum/);
  await writeFile(blobPath(root,key),Buffer.from('%PDF-\nchanged bytes!'));
  await assert.rejects(verifyBlob(root,key,bytes.length));await assert.rejects(writeBlob(root,key,[bytes]));
  assert.throws(()=>blobPath(root,'../file'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('reference object reads refuse symlinks and paths outside the configured archive',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reference-paths-')),outside=await mkdtemp(join(tmpdir(),'reference-outside-')),key='a'.repeat(64);
 try{
  await symlink(outside,join(root,'aa'));await assert.rejects(writeBlob(root,key,[Buffer.from('bad')]));
  await rm(join(root,'aa'));await mkdir(join(root,'aa','aa'),{recursive:true});await writeFile(join(outside,'file'),'bad');await symlink(join(outside,'file'),blobPath(root,key));await assert.rejects(verifyBlob(root,key,3));
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('single byte ranges clamp to size, support suffixes and reject invalid and multiple ranges',()=>{
 assert.equal(parseByteRange(undefined,100),null);assert.deepEqual(parseByteRange('bytes=10-999',100),{start:10,end:99});assert.deepEqual(parseByteRange('bytes=-12',100),{start:88,end:99});assert.deepEqual(parseByteRange('bytes=90-',100),{start:90,end:99});
 for(const value of ['bytes=100-','bytes=-0','bytes=4-2','bytes=0-1,4-5','bytes=-','items=0-1','bytes=9007199254740993-'])assert.equal(parseByteRange(value,100),false);
});
test('binary delivery preserves bytes, streams ranges, revalidates hashes, and retains a bounded legacy fallback',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reference-http-')),bytes=Buffer.from('%PDF-'+ 'preserved original '.repeat(60000)),sha256=hash(bytes);let archived=true,maxSlice=0;
 const pool={async query(sql,params){if(sql.includes('substring(original')){const start=params.at(-2)-1,length=params.at(-1);maxSlice=Math.max(maxSlice,length);return {rows:[{chunk:bytes.subarray(start,start+length)}]};}return {rows:[{sha256,mime_type:'application/pdf',blob_key:archived?sha256:null,bytes:String(bytes.length)}]};}};
 const deliver=async(headers={},method='GET',version=sha256)=>{const res=response();await deliverReferenceFile({url:'/api/knowledge/documents/cr:test/pdf'+(version?'?v='+version:''),method,headers},res,{pool,table:'documents',where:'id=$1',params:['cr:test'],root,filename:'cr-test'});return res;};
 try{
  await writeBlob(root,sha256,[bytes]);let res=await deliver({range:'bytes=3-10'});assert.equal(res.status,206);assert.deepEqual(res.bytes(),bytes.subarray(3,11));assert.equal(res.headers['Content-Range'],`bytes 3-10/${bytes.length}`);assert.match(res.headers['Cache-Control'],/immutable/);
  res=await deliver({'if-none-match':'W/"'+sha256+'"',range:'bytes=4-8'});assert.equal(res.status,304);assert.equal(res.bytes().length,0);
  res=await deliver({range:'bytes=0-1','if-range':'"outdated"'});assert.equal(res.status,200);assert.deepEqual(res.bytes(),bytes);
  res=await deliver({range:'bytes=-5'});assert.deepEqual(res.bytes(),bytes.subarray(-5));
  res=await deliver({range:'bytes=99999999-'});assert.equal(res.status,416);
  res=await deliver({},'HEAD');assert.equal(res.bytes().length,0);assert.equal(res.headers['Content-Length'],bytes.length);
  res=await deliver({},'GET',null);assert.equal(res.headers['Cache-Control'],'public, no-cache');
  await assert.rejects(deliver({},'GET','f'.repeat(64)),error=>error.status===409);
  archived=false;res=await deliver();assert.deepEqual(res.bytes(),bytes);assert.ok(maxSlice<=256*1024);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('portable object streams restore with arbitrary chunk boundaries and reject tampering or truncation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reference-pack-')),destination=await mkdtemp(join(tmpdir(),'reference-unpack-')),bytes=Buffer.from('official original\0\n'+ 'x'.repeat(1000)),sha256=hash(bytes),entries=[{sha256,bytes:bytes.length}];
 try{
  await writeBlob(root,sha256,[bytes]);const chunks=[];for await(const chunk of packObjects(root,entries))chunks.push(chunk);const packed=Buffer.concat(chunks);
  async function* split(buffer){for(let at=0;at<buffer.length;at+=7)yield buffer.subarray(at,at+7);}
  await unpackObjects(destination,entries,split(packed));assert.deepEqual(await readFile(blobPath(destination,sha256)),bytes);
  const broken=Buffer.from(packed);broken[broken.length-3]^=1;await assert.rejects(unpackObjects(destination,entries,split(broken)),/checksum/);
  await assert.rejects(unpackObjects(destination,entries,split(packed.subarray(0,-1))),/Truncated/);
  await assert.rejects(unpackObjects(destination,entries,split(Buffer.concat([packed,Buffer.from('extra')]))),/Unexpected/);
  const inventory={format:'compass-reference-objects-v1',entries,parts:[{index:1,name:'reference-db-qa.objects-0001',bytes:packed.length,sha256:hash(packed),assetId:8}],bytes:packed.length,sha256:hash(packed)};
  validateObjects(inventory);assert.throws(()=>validateObjects({...inventory,entries:[...entries,...entries]}));
  const base={format:'postgresql-custom-data-v2',state:'ready',repository:'zdornik/compas',release:'reference-db-qa',schema:'knowledge',containsPatientData:false,containsSecrets:false,sha256:'a'.repeat(64),bytes:1,tables:{documents:1},requiredMigrations:['019-reference-files'],excludedTables:['catalog_state'],parts:[{index:1,name:'reference-db-qa.part-0001',bytes:1,sha256:'b'.repeat(64),assetId:7}],objects:inventory};
  validateSnapshot(base);assert.throws(()=>validateSnapshot({...base,objects:undefined}));
 }finally{await rm(root,{recursive:true,force:true});await rm(destination,{recursive:true,force:true});}
});
test('offline reader index preserves search normalization and reports uncertain extraction without inventing clinical text',()=>{
 const pages=[{page:1,text:'НЕ применять. 5 мг. Ёжик\u00ad\n',layout:{version:1,blocks:[{type:'paragraph',text:'НЕ применять. 5 мг. Ёжик\u00ad'}]}},{page:2,text:'таблица',layout:{version:1,blocks:[{type:'figure',text:'таблица',assetId:'a'.repeat(32),reason:'source_character_coverage_mismatch'}]}},{page:3,text:'',layout:null}];
 const {manifest,searchPages}=buildReaderIndex({kind:'clinical_recommendation',sha256:'b'.repeat(64)},pages);
 assert.equal(manifest.pages[1].quality,'source_image');assert.equal(manifest.pages[2].quality,'scan');assert.match(searchPages[0].text,/не применять\. 5 мг\. ежик/);assert.equal(pages[0].text,'НЕ применять. 5 мг. Ёжик\u00ad\n');
 assert.equal(buildReaderIndex({kind:'clinical_recommendation',sha256:'b'.repeat(64)},pages).manifest.revision,manifest.revision);
 const changed=structuredClone(pages);changed[0].text='изменено';assert.notEqual(buildReaderIndex({kind:'clinical_recommendation',sha256:'b'.repeat(64)},changed).manifest.revision,manifest.revision);
});
test('only public source JSON is compressed and validated; unversioned searches remain no-store',()=>{
 const value={text:'исходный текст '.repeat(1000)},revision='a'.repeat(64);let res=response();referenceJson({headers:{'accept-encoding':'gzip'}},res,value,{revision,immutable:true});assert.equal(res.headers['Content-Encoding'],'gzip');assert.deepEqual(JSON.parse(gunzipSync(res.bytes())),value);assert.match(res.headers.ETag,/^W\//);
 const etag=res.headers.ETag;assert.equal(matchesEtag(etag,'"'+revision+'"'),true);
 res=response();referenceJson({headers:{'if-none-match':etag}},res,value,{revision});assert.equal(res.status,304);
 res=response();referenceJson({headers:{'accept-encoding':'gzip;q=0'}},res,value);assert.equal(res.headers['Content-Encoding'],undefined);assert.equal(res.headers['Cache-Control'],'no-store');
});
