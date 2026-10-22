// Integration verification on an explicitly isolated QA database and official sample.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createKnowledgeApi} from '../server/knowledge.mjs';
import {publishReferenceFiles} from '../server/publish-reference-files.mjs';
import {findGuidelineMatches,formatGuidelinePage} from '../src/guidelines.js';
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
const database=process.env.DB_NAME;
if(!/^compass_(?:reference|journal)_qa_[a-f0-9]+$/.test(database||''))throw new Error('An isolated QA database is required');
const sample=JSON.parse(await readFile(arg('--source'),'utf8')),layout=JSON.parse(await readFile(arg('--layout'),'utf8'));
const bytes=await readFile(sample.filePath),hash=value=>createHash('sha256').update(value).digest('hex');
assert.equal(hash(bytes),sample.sha256);assert.equal(layout.sourceSha256,sample.sha256);assert.equal(layout.documentId,sample.id);
const config={host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||5432),database};
const admin=new pg.Pool({...config,user:'compass_admin',password:(await readFile(process.env.ADMIN_DB_PASSWORD_FILE,'utf8')).trim(),max:1});
const runtime=new pg.Pool({...config,user:'compass_app',password:(await readFile(process.env.APP_DB_PASSWORD_FILE||'.local-secrets/app_db_password','utf8')).trim(),max:4});
const client=await admin.connect();let server;
try{
 const existing=(await client.query('SELECT id FROM knowledge.documents')).rows;assert.ok(existing.every(row=>row.id===sample.id),'QA reference store must be empty or contain only this sample');
 await client.query('BEGIN');
 try{
  await client.query('DELETE FROM knowledge.pages WHERE document_id=$1',[sample.id]);
  await client.query('DELETE FROM knowledge.documents WHERE id=$1',[sample.id]);
  await client.query(`INSERT INTO knowledge.sources(id,name,url,license,coverage) VALUES('minzdrav-cr','Минздрав России',$1,'Официальный исходник: локальная проверка','Один документ') ON CONFLICT(id) DO NOTHING`,[sample.landingUrl]);
  await client.query(`INSERT INTO knowledge.documents(id,source_id,kind,external_id,title,version,source_url,landing_url,source_status,icd10,age_category,sha256,original,retrieved_at,metadata) VALUES($1,'minzdrav-cr','clinical_recommendation',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[sample.id,sample.externalId,sample.title,sample.version,sample.sourceUrl,sample.landingUrl,sample.sourceStatus,sample.icd10,sample.ageCategory,sample.sha256,bytes,sample.retrievedAt,JSON.stringify({...sample.metadata,layoutExtractor:layout.extractor})]);
  await client.query(`INSERT INTO knowledge.pages(document_id,page,text_content,layout) SELECT $1,x.page,x.text,x.layout FROM jsonb_to_recordset($2::jsonb) AS x(page integer,text text,layout jsonb)`,[sample.id,JSON.stringify(layout.pages)]);
  for(const asset of layout.assets){const image=await readFile(asset.filePath);assert.equal(hash(image),asset.sha256);await client.query(`INSERT INTO knowledge.page_assets(document_id,page,id,mime_type,sha256,original) VALUES($1,$2,$3,'image/png',$4,$5)`,[sample.id,asset.page,asset.id,asset.sha256,image]);}
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
 const api=createKnowledgeApi(runtime);server=createServer((req,res)=>api(req,res,new URL(req.url,'http://localhost').pathname));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port,path='/api/knowledge/documents/'+sample.id;
 let response=await fetch(origin+path+'/pdf',{headers:{Range:'bytes=0-31'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(0,32));
 const moved=await publishReferenceFiles(client,{id:sample.id,verify:true});
 assert.equal(moved.documents,1);assert.equal(moved.objects,layout.assets.length+1);assert.ok(moved.movedBytes>=bytes.length);
 const second=await publishReferenceFiles(client,{id:sample.id,verify:true});assert.equal(second.movedBytes,0);
 assert.equal((await client.query('SELECT count(*)::int n FROM knowledge.documents WHERE original IS NOT NULL')).rows[0].n,0);assert.equal((await client.query('SELECT count(*)::int n FROM knowledge.page_assets WHERE original IS NOT NULL')).rows[0].n,0);
 response=await fetch(origin+path+'/pdf?v='+sample.sha256,{headers:{Range:'bytes=0-31'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(0,32));assert.match(response.headers.get('cache-control'),/immutable/);
 response=await fetch(origin+path+'/pdf?v='+sample.sha256);assert.equal(hash(Buffer.from(await response.arrayBuffer())),sample.sha256);
 response=await fetch(origin+path+'/pdf?v='+sample.sha256,{headers:{'If-None-Match':'"'+sample.sha256+'"'}});assert.equal(response.status,304);
 response=await fetch(origin+path+'/pdf',{method:'HEAD'});assert.equal(response.status,200);assert.equal(Number(response.headers.get('content-length')),bytes.length);
 response=await fetch(origin+path+'/reader-index');assert.equal(response.status,200);const index=await response.json();assert.equal(index.pages.length,layout.pages.length);
 response=await fetch(origin+path+'/reader?from=11&limit=5&v='+index.revision);assert.equal(response.status,200);const partial=await response.json();assert.deepEqual(partial.pages.map(row=>row.page),[11,12,13,14,15]);assert.match(response.headers.get('cache-control'),/immutable/);
 const query='не должен',expected=findGuidelineMatches(layout.pages.map(page=>formatGuidelinePage(page,index.outline)),query);
 response=await fetch(origin+path+'/reader-search?q='+encodeURIComponent(query)+'&v='+index.revision);assert.equal(response.status,200);assert.deepEqual(await response.json(),expected);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(expected.total>0);
 response=await fetch(origin+path+'/reader?from=1&v='+'f'.repeat(64));assert.equal(response.status,409);
 for(const asset of layout.assets){response=await fetch(origin+path+'/assets/'+asset.id+'?v='+asset.sha256);assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),asset.sha256);}
 await assert.rejects(runtime.query('UPDATE knowledge.documents SET title=title'));
 await assert.rejects(client.query('UPDATE knowledge.documents SET blob_key=NULL WHERE id=$1',[sample.id]));
 const fullBytes=Buffer.byteLength(JSON.stringify({pages:layout.pages})),initialBytes=Buffer.byteLength(JSON.stringify(index))+Buffer.byteLength(JSON.stringify(partial));
 const report={passed:true,document:sample.id,pages:layout.pages.length,assets:layout.assets.length,originalBytes:bytes.length,movedBytes:moved.movedBytes,embeddedBinaryBytesAfter:0,legacyAndArchivedRangeVerified:true,allOriginalHashesVerified:true,idempotentPublication:true,literalSearchExactlyMatchesFullReader:true,fullReaderJsonBytes:fullBytes,indexAndFivePagesJsonBytes:initialBytes,initialTextReductionPercent:Math.round((1-initialBytes/fullBytes)*100),runtimeReferenceWritesDenied:true};
 await client.query('SELECT knowledge.refresh_reference_status()');
 await writeFile('qa/reference-files-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}client.release();await admin.end();await runtime.end();}
