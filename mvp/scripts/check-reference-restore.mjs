import {packObjects} from './reference-objects.mjs';
import {referenceFilesRoot} from '../server/reference-files.mjs';
// Real public-reference fixture; separate empty Docker stack, never patient data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink,copyFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {command,processDone,sql,dockerSqlArgs,validateSnapshot,REFERENCE_REPOSITORY} from './reference-snapshot.mjs';
const suffix=randomBytes(4).toString('hex'),sourceDb='compass_reference_qa_'+suffix,folder=resolve('qa/reference-restore-'+suffix),project='compass-reference-qa-'+suffix,origin='http://127.0.0.1:4177';
await mkdir(folder,{recursive:true});await mkdir(resolve(folder,'knowledge-empty'));await mkdir(resolve(folder,'parts'));await mkdir(resolve(folder,'corrupt'));
const overlay=resolve(folder,'compose.qa.yaml'),testEnv={...process.env,REFERENCE_FILES_DIR:resolve(folder,'knowledge-empty/archive/blobs'),COMPOSE_PROJECT_NAME:project,COMPOSE_FILE:resolve('compose.yaml')+':'+overlay,COMPASS_LOCAL_ORIGIN:origin};
const targetSql=statement=>command('docker',[...dockerSqlArgs(),'-c',statement],{env:testEnv});
const q=value=>"'"+value.replaceAll("'","''")+"'",list=values=>values.map(q).join(',');
let targetCreated=false,sourceCreated=false;
try{
 await sql('CREATE DATABASE "'+sourceDb+'"');sourceCreated=true;await sql('CREATE EXTENSION IF NOT EXISTS pg_trgm',{database:sourceDb});
 const dump=spawn('docker',['compose','exec','-T','db','pg_dump','-U','compass_admin','-d','compass','--schema=knowledge','--schema-only','--no-owner','--no-privileges','--no-large-objects'],{stdio:['ignore','pipe','inherit']}),dumpDone=processDone(dump);
 const schema=spawn('docker',dockerSqlArgs(sourceDb),{stdio:['pipe','ignore','inherit']}),schemaDone=processDone(schema);await pipeline(dump.stdout,schema.stdin);await Promise.all([dumpDone,schemaDone]);
 const migrations=JSON.parse(await sql("SELECT json_agg(id ORDER BY id) FROM public.schema_migrations"));await sql('CREATE TABLE public.schema_migrations(id text PRIMARY KEY);INSERT INTO public.schema_migrations(id) VALUES '+migrations.map(id=>'('+q(id)+')').join(','),{database:sourceDb});
 const pids=JSON.parse(await sql("SELECT json_agg(id) FROM (SELECT DISTINCT ON(inn) id FROM knowledge.products WHERE inn IN ('Гидроксизин','Сертралин','Валсартан+Розувастатин') AND instruction_document_id IS NOT NULL AND source_status='Действующий' ORDER BY inn,id) x"));assert.equal(pids.length,3);
 const sids=JSON.parse(await sql("SELECT json_agg(id) FROM knowledge.substances WHERE source_id='grls' AND name_ru IN ('Гидроксизин','Сертралин','Валсартан','Розувастатин','Валсартан+Розувастатин')"));assert.equal(sids.length,5);
 const ingredientIds=JSON.parse(await sql('SELECT json_agg(DISTINCT ingredient_id) FROM knowledge.registry_components WHERE substance_id IN ('+list(sids)+')'));
 const providerIds=JSON.parse(await sql('SELECT json_agg(DISTINCT external_id) FROM knowledge.provider_ingredients WHERE ingredient_id IN ('+list(ingredientIds)+')'));
 const docIds=JSON.parse(await sql("SELECT json_agg(DISTINCT id) FROM (SELECT 'cr:452_3'::text id UNION SELECT instruction_document_id FROM knowledge.products WHERE id IN ("+list(pids)+') UNION SELECT document_id FROM knowledge.product_documents WHERE product_id IN ('+list(pids)+')) x'));
 const predicate={
  sources:'true',documents:'id IN ('+list(docIds)+')',substances:'id IN ('+list(sids)+')',source_drugs:'true',conditions:'true',condition_mappings:'true',inn_terms:'true',
  nsi_drug_snapshots:'true',nsi_drug_terms:'true',nsi_substance_terms:'substance_id IN ('+list(sids)+')',ingredient_entities:'id IN ('+list(ingredientIds)+')',
  registry_compositions:'substance_id IN ('+list(sids)+')',registry_components:'substance_id IN ('+list(sids)+')',provider_ingredients:'ingredient_id IN ('+list(ingredientIds)+')',composition_dependencies:'combination_id IN ('+list(sids)+')',manual_ingredient_reviews:'substance_id IN ('+list(sids)+')',
  products:'id IN ('+list(pids)+')',product_documents:'product_id IN ('+list(pids)+')',pages:'document_id IN ('+list(docIds)+')',reader_indexes:'document_id IN ('+list(docIds)+')',page_assets:'document_id IN ('+list(docIds)+')',
  interactions:'source_drug_a_id IN ('+list(providerIds)+') AND source_drug_b_id IN ('+list(providerIds)+')',disease_interactions:'drug_id IN ('+list(providerIds)+')',substance_search_aliases:'substance_id IN ('+list(sids)+')',
  esklp_snapshots:'true',esklp_product_links:'product_id IN ('+list(pids)+')',
  esklp_klp:'(snapshot_id,code) IN (SELECT snapshot_id,klp_code FROM knowledge.esklp_product_links WHERE product_id IN ('+list(pids)+'))',
  esklp_smnn:'(snapshot_id,code) IN (SELECT snapshot_id,smnn_code FROM knowledge.esklp_product_links WHERE product_id IN ('+list(pids)+'))',
  esklp_trade_names:'(snapshot_id,smnn_code) IN (SELECT snapshot_id,smnn_code FROM knowledge.esklp_product_links WHERE product_id IN ('+list(pids)+'))'
 };
 // Copy source data without changing a field; generated columns are recomputed.
 for(const [table,where]of Object.entries(predicate)){
  const columns=JSON.parse(await sql("SELECT json_agg(attname ORDER BY attnum) FROM pg_attribute WHERE attrelid='knowledge."+table+"'::regclass AND attnum>0 AND NOT attisdropped AND attgenerated=''")).map(c=>'"'+c+'"').join(',');
  const from=spawn('docker',[...dockerSqlArgs(),'-c',`COPY (SELECT ${columns} FROM knowledge.${table} WHERE ${where}) TO STDOUT WITH (FORMAT binary)`],{stdio:['ignore','pipe','inherit']}),fromDone=processDone(from);
  const to=spawn('docker',[...dockerSqlArgs(sourceDb),'-c',`COPY knowledge.${table} (${columns}) FROM STDIN WITH (FORMAT binary)`],{stdio:['pipe','ignore','inherit']}),toDone=processDone(to);await pipeline(from.stdout,to.stdin);await Promise.all([fromDone,toDone]);
 }
 await sql('SELECT knowledge.refresh_reference_catalog()',{database:sourceDb});
 const tables=JSON.parse(await sql("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='knowledge' AND tablename<>'catalog_state'",{database:sourceDb}));
 const counts=JSON.parse(await sql('SELECT json_build_object('+tables.map(t=>q(t)+',(SELECT count(*) FROM knowledge.'+t+')').join(',')+')',{database:sourceDb}));
 const archive=resolve(folder,'fixture.dump'),out=spawn('docker',['compose','exec','-T','db','pg_dump','-U','compass_admin','-d',sourceDb,'--schema=knowledge','--data-only','--no-owner','--no-privileges','--no-large-objects','--exclude-table-data=knowledge.catalog_state','--format=custom','--compress=gzip:3'],{stdio:['ignore','pipe','inherit']}),outDone=processDone(out);await pipeline(out.stdout,createWriteStream(archive,{flags:'wx'}));await outDone;
 const data=await readFile(archive),manifest={format:'postgresql-custom-data-v1',state:'ready',repository:REFERENCE_REPOSITORY,release:'reference-db-qa-'+suffix,schema:'knowledge',containsPatientData:false,containsSecrets:false,postgresMajor:17,capturedAt:new Date().toISOString(),requiredMigrations:migrations,tables:counts,excludedTables:['catalog_state'],bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),parts:[]};
 for(let start=0,index=1;start<data.length;start+=1024**2,index++){const bytes=data.subarray(start,start+1024**2),name='reference-db-qa-'+suffix+'.part-'+String(index).padStart(4,'0');await writeFile(resolve(folder,'parts',name),bytes);manifest.parts.push({index,name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),assetId:index});}
 const entries=JSON.parse(await sql("SELECT coalesce(json_agg(x ORDER BY x.sha256),'[]'::json) FROM (SELECT blob_key AS sha256,max(original_bytes)::bigint AS bytes FROM (SELECT blob_key,original_bytes FROM knowledge.documents UNION ALL SELECT blob_key,original_bytes FROM knowledge.page_assets) b WHERE blob_key IS NOT NULL GROUP BY blob_key) x",{database:sourceDb}));
 if(entries.length){
  const chunks=[];for await(const chunk of packObjects(referenceFilesRoot(),entries))chunks.push(chunk);const objects=Buffer.concat(chunks),name='reference-db-qa-'+suffix+'.objects-0001';await writeFile(resolve(folder,'parts',name),objects);manifest.format='postgresql-custom-data-v2';manifest.objects={format:'compass-reference-objects-v1',entries,bytes:objects.length,sha256:createHash('sha256').update(objects).digest('hex'),parts:[{index:1,name,bytes:objects.length,sha256:createHash('sha256').update(objects).digest('hex'),assetId:manifest.parts.length+1}]};
 }
 validateSnapshot(manifest);await unlink(archive);const manifestFile=resolve(folder,'manifest.json');await writeFile(manifestFile,JSON.stringify(manifest,null,2));
 await command(process.execPath,[resolve('scripts/init-local-secrets.mjs')],{cwd:folder,capture:false});
 const health="require('node:http').get({host:'127.0.0.1',port:8080,path:'/api/health',headers:{Host:'127.0.0.1:4177'}},r=>{r.resume();if(r.statusCode!==200)process.exit(1)}).on('error',()=>process.exit(1))";
 await writeFile(overlay,'services:\n  web:\n    ports: !override ["127.0.0.1:4177:8080"]\n    environment:\n      SITE_ORIGIN: '+origin+'\n    volumes: !override ['+JSON.stringify(resolve(folder,'knowledge-empty')+':/app/knowledge:ro')+']\n    healthcheck:\n      test: '+JSON.stringify(['CMD','node','-e',health])+'\n  reference-publish:\n    volumes: !override ['+JSON.stringify(resolve(folder,'knowledge-empty')+':/app/knowledge')+']\nsecrets:\n'+['admin_db_password','app_db_password','data_key','journal_db_password'].map(n=>'  '+n+':\n    file: '+JSON.stringify(resolve(folder,'.local-secrets',n))).join('\n')+'\n');
 targetCreated=true;await command('docker',['compose','up','-d','--wait','db'],{env:testEnv,capture:false});await command('docker',['compose','run','--rm','migrate'],{env:testEnv,capture:false});
 const first=manifest.parts[0];await copyFile(resolve(folder,'parts',first.name),resolve(folder,'corrupt',first.name));const broken=await readFile(resolve(folder,'corrupt',first.name));broken[0]^=1;await writeFile(resolve(folder,'corrupt',first.name),broken);
 await assert.rejects(()=>command(process.execPath,['scripts/restore-reference-db.mjs','--manifest',manifestFile,'--local-parts',resolve(folder,'corrupt')],{env:testEnv}));assert.equal(await targetSql('SELECT count(*) FROM knowledge.documents'),'0');
 const badWhole=resolve(folder,'bad-whole.json');await writeFile(badWhole,JSON.stringify({...manifest,sha256:'0'.repeat(64)}));
 await assert.rejects(()=>command(process.execPath,['scripts/restore-reference-db.mjs','--manifest',badWhole,'--local-parts',resolve(folder,'parts')],{env:testEnv}));
 assert.equal(await targetSql('SELECT '+Object.keys(counts).map(t=>'(SELECT count(*) FROM knowledge.'+t+')').join('+')),'0');
 await command(process.execPath,['scripts/start-local.mjs','--no-build','--manifest',manifestFile,'--local-parts',resolve(folder,'parts')],{env:testEnv,capture:false});
 const get=async path=>{const r=await fetch(origin+'/api/knowledge/'+path);assert.equal(r.status,200,path);return r;};
 const status=await (await get('status')).json();assert.equal(status.counts.products,3);assert.equal(status.counts.clinicalDocuments,1);
 const pair=await (await get('interactions?'+pids.map(id=>'id='+id).join('&'))).json();assert.equal(pair.identityMappings.filter(m=>m.status==='mapped').length,3);assert.equal(pair.identityMappings.find(m=>m.nameRu==='Валсартан+Розувастатин').nameEn,'valsartan + rosuvastatin');assert.equal(pair.safeToCombine,null);
 const original=await get('documents/cr:452_3/pdf'),bytes=Buffer.from(await original.arrayBuffer()),expected=await sql("SELECT sha256 FROM knowledge.documents WHERE id='cr:452_3'");assert.equal(createHash('sha256').update(bytes).digest('hex'),expected);
 const asset=JSON.parse(await targetSql("SELECT json_build_object('id',id,'sha256',sha256) FROM knowledge.page_assets WHERE document_id='cr:452_3' LIMIT 1"));assert.ok(asset?.id);const image=Buffer.from(await (await get('documents/cr:452_3/assets/'+asset.id)).arrayBuffer());assert.equal(createHash('sha256').update(image).digest('hex'),asset.sha256);
 const sourceReader=await (await get('documents/cr:452_3/reader')).json();assert.equal(sourceReader.pages.length,43);assert.ok(sourceReader.pages.every(p=>p.layout));
 const patientCount=await targetSql('SELECT (SELECT count(*) FROM auth_accounts)+(SELECT count(*) FROM patient_entries)+(SELECT count(*) FROM care_links)+(SELECT count(*) FROM journal_notes)+(SELECT count(*) FROM journal_analysis_jobs)+(SELECT count(*) FROM journal_note_analyses)+(SELECT count(*) FROM doctor_note_alerts)+(SELECT count(*) FROM care_appointments)+(SELECT count(*) FROM care_appointment_events)');assert.equal(patientCount,'0');
 assert.equal(await targetSql("SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='knowledge' AND grantee='compass_app' AND privilege_type<>'SELECT'"),'0');
 await command(process.execPath,['scripts/restore-reference-db.mjs','--manifest',manifestFile,'--local-parts',resolve(folder,'parts')],{env:testEnv,capture:false});
 const report={passed:true,freshDockerStack:true,sourceFilesRestoredFromSnapshot:true,corruptedPartRejectedBeforeWrites:true,lateWholeChecksumFailureRolledBack:true,allFixtureTableCountsVerified:true,originalPdfHashMatches:true,layoutAssetHashMatches:true,clinicalReaderPages:43,allThreeIngredientMappingsWork:true,patientRowsImported:0,runtimeReferenceWritesGranted:false,existingDatabasePreservedOnRepeat:true,fixtureBytes:manifest.bytes,fixtureParts:manifest.parts.length};await writeFile(resolve(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 if(targetCreated)await command('docker',['compose','down','-v'],{env:testEnv,capture:false}).catch(()=>{});
 if(sourceCreated)await sql('DROP DATABASE "'+sourceDb+'" WITH (FORCE)').catch(()=>{});
}
