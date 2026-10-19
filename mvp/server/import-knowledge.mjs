import {REFERENCE_WRITE_LOCK,refreshReferenceCatalog} from './refresh-reference-catalog.mjs';
// Offline CLI importer. Never imported by the web API. The admin secret is CLI-only.
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const root = resolve('knowledge');
const jsonFile = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const password = (await readFile(process.env.DB_PASSWORD_FILE, 'utf8')).trim();
const pool = new pg.Pool({ host: process.env.DB_HOST || 'db', database: 'compass', user: 'compass_admin', password, max: 1 });
const client = await pool.connect();
const run = randomUUID(), counts = {};
let rootCatalogLock=false,lastPublicationSignature;
const sources = [
 { id: 'minzdrav-cr', name: 'Рубрикатор клинических рекомендаций Минздрава России', url:'https://cr.minzdrav.gov.ru/clin-rec', license:'Официальные опубликованные документы; условия коммерческого распространения отдельно не подтверждены', coverage:'Действующие документы каталога с любым кодом F00–F99; взрослые и дети, включая смежные специальности' },
 { id: 'grls', name: 'Государственный реестр лекарственных средств', url:'https://grls.minzdrav.gov.ru/grls.aspx', license:'Официальная общедоступная выгрузка для локального исследования; сведения о регистрации не являются инструкциями', coverage:'Полная выгрузка реестра, все опубликованные статусы; инструкции учитываются отдельно' },
 { id: 'ddinter', name:'DDInter 2.0', url:'https://ddinter2.scbdd.com/', license:'CC BY-NC-SA 4.0 · https://ddinter2.scbdd.com/terms/', coverage:'Только фактически загруженные файлы; полнота не гарантируется, отсутствие пары не означает безопасность' },
];
async function batchLines(path, callback, size=600) {
 let batch=[];
 const lines=createInterface({input:createReadStream(resolve(root,path)),crlfDelay:Infinity});
 for await (const line of lines) { if(!line.trim())continue; batch.push(JSON.parse(line)); if(batch.length>=size){await callback(batch);batch=[];} }
 if(batch.length)await callback(batch);
}
async function documentImport(item) {
 const file=resolve(item.filePath);
 if(!file.startsWith(root+sep))throw new Error('Document path outside knowledge archive');
 const original=await readFile(file);
 const mime=item.mimeType||'application/pdf';
 const valid=mime==='application/pdf' ? original.subarray(0,5).equals(Buffer.from('%PDF-')) : mime==='image/jpeg' ? original.subarray(0,3).equals(Buffer.from([255,216,255])) : mime==='image/png' && original.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(!valid)throw new Error('Invalid original document format');
 if(createHash('sha256').update(original).digest('hex')!==item.sha256)throw new Error('Document checksum mismatch');
 if(!/^https:\/\//.test(item.sourceUrl))throw new Error('Untrusted source protocol');
 if(item.kind==='clinical_recommendation'){
  const enriched=await client.query("SELECT id FROM knowledge.documents WHERE id=$1 AND sha256=$2 AND metadata ? 'layoutExtractor'",[item.id,item.sha256]);
  if(enriched.rows.length)return;
 }
 await client.query('BEGIN');
 try {
  await client.query(`INSERT INTO knowledge.documents(id,source_id,kind,external_id,title,version,source_url,landing_url,source_status,icd10,age_category,sha256,original,retrieved_at,publication_date,metadata,mime_type)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
   ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,source_url=EXCLUDED.source_url,landing_url=EXCLUDED.landing_url,source_status=EXCLUDED.source_status,icd10=EXCLUDED.icd10,sha256=EXCLUDED.sha256,original=EXCLUDED.original,retrieved_at=EXCLUDED.retrieved_at,metadata=EXCLUDED.metadata,mime_type=EXCLUDED.mime_type`,
   [item.id,item.sourceId,item.kind,item.externalId,item.title,item.version,item.sourceUrl,item.landingUrl,item.sourceStatus,item.icd10||[],item.ageCategory,item.sha256,original,item.retrievedAt,item.publicationDate,JSON.stringify(item.metadata),mime]);
  await client.query('DELETE FROM knowledge.mentions WHERE document_id=$1',[item.id]);
  await client.query('DELETE FROM knowledge.pages WHERE document_id=$1',[item.id]);
  await client.query(`INSERT INTO knowledge.pages(document_id,page,text_content) SELECT $1,x.page,x.text FROM jsonb_to_recordset($2::jsonb) AS x(page integer,text text)`,[item.id,JSON.stringify(item.pages)]);
  await client.query('COMMIT');
 } catch(error){ await client.query('ROLLBACK');throw error; }
}
async function importPsychiatryScope() {
 const scope=await jsonFile('psychiatry-scope.json'),targets=await jsonFile('processed/instruction-targets.json');
 if(scope.scope!=='psychiatry'||targets.some(item=>item.collectionScope!=='psychiatry'))throw new Error('Invalid psychiatry scope');
 await client.query('BEGIN');
 try {
  await client.query(`UPDATE knowledge.products SET metadata=metadata-'collectionScope'-'scopeReason' WHERE metadata->>'collectionScope'='psychiatry'`);
  await client.query(`UPDATE knowledge.products p SET metadata=p.metadata||jsonb_build_object('collectionScope','psychiatry','scopeReason',x.reason)
   FROM jsonb_to_recordset($1::jsonb) AS x(reg text,reason text) WHERE p.registration_number=x.reg`,[JSON.stringify(targets.map(item=>({reg:item.registrationNumber,reason:item.scopeReason})))]);
  await client.query("UPDATE knowledge.sources SET metadata=metadata||jsonb_build_object('psychiatryScope',$1::jsonb) WHERE id='grls'",[JSON.stringify(scope)]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
}
async function importInstructions() {
 await client.query('SELECT pg_advisory_lock($1)',[REFERENCE_WRITE_LOCK]);
 try {
 const existing=new Map((await client.query("SELECT id,sha256 FROM knowledge.documents WHERE kind='drug_instruction'")).rows.map(row=>[row.id,row.sha256]));
 let names=[];try{names=await readdir(resolve(root,'processed/instructions'));}catch(error){if(error.code!=='ENOENT')throw error;}
 let added=0;
 for(const name of names.filter(n=>n.endsWith('.json'))) {
  if(existing.has('grls-doc:'+name.slice(0,-5)))continue;
  const item=await jsonFile('processed/instructions/'+name);
  if(existing.get(item.id)!==item.sha256){await documentImport(item);added++;}
 }
 let results=[];try{results=await readdir(resolve(root,'raw/instructions/results'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const links=[];
 for(const name of results.filter(n=>n.endsWith('.json'))) {
  const item=await jsonFile('raw/instructions/results/'+name);
  for(const document of item.documents||[])links.push({reg:item.registrationNumber,document});
 }
 await client.query('BEGIN');
 if(links.length)await client.query(`INSERT INTO knowledge.product_documents(product_id,document_id)
  SELECT p.id,x.document FROM jsonb_to_recordset($1::jsonb) AS x(reg text,document text)
  JOIN knowledge.products p ON p.registration_number=x.reg JOIN knowledge.documents d ON d.id=x.document
  ON CONFLICT DO NOTHING`,[JSON.stringify(links)]);
 await client.query(`UPDATE knowledge.products p SET instruction_document_id=x.document_id FROM
  (SELECT product_id,min(document_id) document_id FROM knowledge.product_documents GROUP BY product_id) x
  WHERE p.id=x.product_id AND p.instruction_document_id IS DISTINCT FROM x.document_id`);
 let progress={status:'not_started'};
 try {
  const item=await jsonFile('instructions-manifest.json');
  progress={status:item.status,scope:item.scope,registryNames:item.scopeRegistryNames,targets:item.allTargetRegistrations,queued:item.targetRegistrations,
   processed:item.results.length+item.errors.length,errors:item.errors.length,
   downloadedRegistrations:item.results.filter(x=>x.status==='downloaded').length,
   unavailableRegistrations:item.results.filter(x=>x.status!=='downloaded').length};
 }catch(error){if(error.code!=='ENOENT')throw error;}
 await client.query("UPDATE knowledge.sources SET metadata=jsonb_set(metadata,'{instructionProgress}',$1::jsonb) WHERE id='grls'",[JSON.stringify(progress)]);
 const signature=JSON.stringify({progress,links:links.length});
 if(added||signature!==lastPublicationSignature)await refreshReferenceCatalog(client);
 await client.query('COMMIT');lastPublicationSignature=signature;
 return {added,progress};
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{await client.query('SELECT pg_advisory_unlock($1)',[REFERENCE_WRITE_LOCK]);}
}
try {
 await client.query('SELECT pg_advisory_lock(2026101802)');
 await client.query('SELECT pg_advisory_lock($1)',[REFERENCE_WRITE_LOCK]);rootCatalogLock=true;
 await client.query(`INSERT INTO knowledge.import_runs(id,started_at,status) VALUES($1,now(),'running')`,[run]);
 for(const source of sources) await client.query(`INSERT INTO knowledge.sources(id,name,url,license,coverage,retrieved_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,url=EXCLUDED.url,license=EXCLUDED.license,coverage=EXCLUDED.coverage,retrieved_at=now()`,[source.id,source.name,source.url,source.license,source.coverage]);
 const clinical=await jsonFile('clinical-manifest.json');
 if(clinical.errors.length || clinical.completed.length!==clinical.selectedTotal)throw new Error('Clinical corpus incomplete; fix manifest before import');
 for(const name of (await readdir(resolve(root,'processed/clinical'))).filter(n=>/^\d+_\d+\.json$/.test(n)).sort()){
  await documentImport(await jsonFile('processed/clinical/'+name));
  console.log('Imported document',name);
 }
 const substances=await jsonFile('processed/grls-substances.json');
 await client.query(`INSERT INTO knowledge.substances(id,name_ru,normalized_name,source_id,kind,metadata)
  SELECT x.id,x."nameRu",x."normalizedName",x."sourceId",x.kind,to_jsonb(x) FROM jsonb_to_recordset($1::jsonb) AS x(id text,"nameRu" text,"normalizedName" text,"sourceId" text,kind text)
  ON CONFLICT(id) DO UPDATE SET name_ru=EXCLUDED.name_ru`,[JSON.stringify(substances)]);
 const products=await jsonFile('grls-manifest.json');
 await batchLines('processed/grls-products.jsonl',async rows=>{
  const unique=[...new Map(rows.map(row=>[row.id,row])).values()];
  await client.query(`INSERT INTO knowledge.products(id,source_id,registration_number,trade_name,inn,form,source_status,substance_id,metadata)
   SELECT x.id,'grls',x."registrationNumber",x."tradeName",x.inn,x.form,x.status,s.id,x.meta
   FROM (SELECT v.*,to_jsonb(v) meta FROM jsonb_to_recordset($1::jsonb) AS v(id text,"registrationNumber" text,"tradeName" text,inn text,form text,status text,"registeredAt" text,"expiresAt" text,"annulledAt" text,holder text,country text,"pharmacotherapeuticGroup" text,"sourceSha256" text,"sourceWorkbook" text)) x
   LEFT JOIN knowledge.substances s ON s.source_id='grls' AND s.normalized_name=replace(lower(regexp_replace(trim(x.inn),'\\s+',' ','g')),'ё','е')
   ON CONFLICT(id) DO UPDATE SET metadata=EXCLUDED.metadata`,[JSON.stringify(unique)]);
 });
 await batchLines('processed/mentions.jsonl',async rows=>{
  await client.query(`INSERT INTO knowledge.mentions(document_id,page,substance_id,start_offset,matched_text,context,method,review_status)
   SELECT x."documentId",x.page,x."substanceId",x."startOffset",x."matchedText",x.context,x.method,x."reviewStatus"
   FROM jsonb_to_recordset($1::jsonb) AS x("documentId" text,page integer,"substanceId" text,"startOffset" integer,"matchedText" text,context text,method text,"reviewStatus" text)
   WHERE NOT EXISTS(SELECT 1 FROM knowledge.documents d WHERE d.id=x."documentId" AND d.metadata ? 'layoutExtractor')
   ON CONFLICT DO NOTHING`,[JSON.stringify(rows)]);
 });
 await importPsychiatryScope();
 await importInstructions();
 // DDI import is optional and must identify original source/terms. Never invent a negative pair.
 try {
  await batchLines('processed/interactions.jsonl',async rows=>{
   await client.query(`INSERT INTO knowledge.interactions(id,source_id,source_drug_a_id,source_drug_b_id,drug_a_name,drug_b_name,source_severity,source_url,source_sha256,metadata)
    SELECT x.id,'ddinter',x."drugAId",x."drugBId",x."drugAName",x."drugBName",x.severity,x."sourceUrl",x.sha256,x.meta
    FROM (SELECT v.*,to_jsonb(v) meta FROM jsonb_to_recordset($1::jsonb) AS v(id text,"drugAId" text,"drugBId" text,"drugAName" text,"drugBName" text,severity text,"sourceUrl" text,sha256 text)) x
    ON CONFLICT(id) DO NOTHING`,[JSON.stringify(rows)]);
  });
 }catch(error){if(error.code!=='ENOENT')throw error;}
 for(const table of ['documents','pages','products','substances','mentions','interactions']) counts[table]=Number((await client.query(`SELECT count(*) n FROM knowledge.${table}`)).rows[0].n);
 const metadata={clinical,grls:products,mentions:await jsonFile('mentions-manifest.json')};
 for(const [id,value]of [['minzdrav-cr',metadata.clinical],['grls',metadata.grls]])await client.query('UPDATE knowledge.sources SET metadata=$2::jsonb WHERE id=$1',[id,JSON.stringify(value)]);
 let ddi={status:'not_loaded',reason:'Source download unavailable; no complete interaction dataset loaded'};
 try{ddi=await jsonFile('ddinter-manifest.json');}catch(error){if(error.code!=='ENOENT')throw error;}
 await client.query('UPDATE knowledge.sources SET metadata=$2::jsonb WHERE id=$1',['ddinter',JSON.stringify(ddi)]);
 await importPsychiatryScope();
 await importInstructions();
 await client.query(`UPDATE knowledge.import_runs SET finished_at=now(),status='completed',counts=$2::jsonb WHERE id=$1`,[run,JSON.stringify(counts)]);
 await refreshReferenceCatalog(client);
 await client.query('SELECT pg_advisory_unlock($1)',[REFERENCE_WRITE_LOCK]);rootCatalogLock=false;
 console.log(JSON.stringify({run,counts,clinicalUseApproved:false}));
 if(process.argv.includes('--follow')) {
  await client.query("UPDATE knowledge.import_runs SET status='following_instructions',finished_at=NULL WHERE id=$1",[run]);
  let previous='';
  while(true) {
   const state=await importInstructions();
   const signature=JSON.stringify(state.progress);
   if(state.added || signature!==previous){console.log(JSON.stringify({instructionImport:state}));previous=signature;}
   if(['completed','partial'].includes(state.progress.status)){await client.query("UPDATE knowledge.import_runs SET status=$2,finished_at=now() WHERE id=$1",[run,state.progress.status]);break;}
   await new Promise(resolve=>setTimeout(resolve,30000));
  }
 }

} catch(error) {
 await client.query(`UPDATE knowledge.import_runs SET finished_at=now(),status='failed',errors=$2::jsonb WHERE id=$1`,[run,JSON.stringify([{message:error.message}])]).catch(()=>{});
 console.error('Knowledge import failed:',error.message);process.exitCode=1;
} finally {if(rootCatalogLock)await client.query('SELECT pg_advisory_unlock($1)',[REFERENCE_WRITE_LOCK]).catch(()=>{});await client.query('SELECT pg_advisory_unlock(2026101802)').catch(()=>{});client.release();await pool.end();}
