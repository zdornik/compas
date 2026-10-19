// Offline public-reference import. No account/health tables and no DDI writes.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
const root='knowledge/',manifest=JSON.parse(await readFile(root+'esklp-manifest.json'));
const checksum=async path=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');};
if(await checksum(root+'raw/esklp/'+manifest.archiveName)!==manifest.archiveSha256)throw new Error('ESKLP archive checksum mismatch');
for(const value of Object.values(manifest.files))if(await checksum(root+value.path)!==value.sha256)throw new Error('Prepared ESKLP checksum mismatch');
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1}),db=await pool.connect();
const id=manifest.archiveSha256;
async function load(kind,sql){
 let batch=[],count=0;
 const flush=async()=>{if(!batch.length)return;await db.query(sql,[id,JSON.stringify(batch)]);count+=batch.length;batch=[];};
 for await(const line of createInterface({input:createReadStream(root+manifest.files[kind].path),crlfDelay:Infinity})){if(line.trim())batch.push(JSON.parse(line));if(batch.length===1500)await flush();}
 await flush();if(count!==manifest.files[kind].rows)throw new Error('Incomplete ESKLP file');console.log(JSON.stringify({loaded:kind,rows:count}));
}
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(2026101907)');
 const existing=(await db.query('SELECT active FROM knowledge.esklp_snapshots WHERE id=$1',[id])).rows[0];
 if(!existing){
  await db.query('INSERT INTO knowledge.esklp_snapshots(id,snapshot_date,manifest) VALUES($1,$2,$3)',[id,manifest.snapshotDate,manifest]);
  await load('smnn',`INSERT INTO knowledge.esklp_smnn SELECT $1,x.code,x."nameRu",x.form,x.dosage,x.atc,x."normalizedNames",x."invalidData",x."validFrom",x."validUntil",x.workbook,x."row" FROM jsonb_to_recordset($2::jsonb) AS x(code text,"nameRu" text,form text,dosage text,atc text,"normalizedNames" text,"invalidData" text,"validFrom" date,"validUntil" date,workbook text,"row" int)`);
  await load('klp',`INSERT INTO knowledge.esklp_klp SELECT $1,x.workbook,x."row",x.code,x."smnnCode",x."nameRu",x."normalizedInn",x."tradeName",x.form,x.dosage,x."registrationNumber",x.holder,x."invalidData",x."validFrom",x."validUntil" FROM jsonb_to_recordset($2::jsonb) AS x(workbook text,"row" int,code text,"smnnCode" text,"nameRu" text,"normalizedInn" text,"tradeName" text,form text,dosage text,"registrationNumber" text,holder text,"invalidData" text,"validFrom" date,"validUntil" date)`);
  await load('trade-names',`INSERT INTO knowledge.esklp_trade_names SELECT $1,x."row",x."smnnCode",x."tradeName",x."registrationNumber",x."nameRu",x.form,x.dosage,x."normalizedNames",x.workbook FROM jsonb_to_recordset($2::jsonb) AS x("row" int,"smnnCode" text,"tradeName" text,"registrationNumber" text,"nameRu" text,form text,dosage text,"normalizedNames" text,workbook text)`);
 }
 await db.query('ANALYZE knowledge.esklp_klp');await db.query('ANALYZE knowledge.esklp_smnn');
 const orphaned=(await db.query('SELECT count(*)::int n FROM knowledge.esklp_klp k LEFT JOIN knowledge.esklp_smnn s ON s.snapshot_id=k.snapshot_id AND s.code=k.smnn_code WHERE k.snapshot_id=$1 AND s.code IS NULL',[id])).rows[0].n;
 if(orphaned)throw new Error('ESKLP contains KLP references missing from SMNN snapshot');
 await db.query('DELETE FROM knowledge.esklp_product_links WHERE snapshot_id=$1',[id]);
 await db.query(`INSERT INTO knowledge.esklp_product_links SELECT DISTINCT $1,p.id,k.code,k.smnn_code,k.normalized_inn,CASE WHEN knowledge.esklp_name_key(k.normalized_inn)=knowledge.esklp_name_key(p.inn) THEN 'exact_registry_inn' ELSE 'name_difference' END FROM knowledge.esklp_klp k JOIN knowledge.esklp_smnn s ON s.snapshot_id=k.snapshot_id AND s.code=k.smnn_code JOIN knowledge.products p ON p.registration_number=k.registration_number AND knowledge.esklp_trade_key(p.trade_name)=knowledge.esklp_trade_key(k.trade_name) WHERE k.snapshot_id=$1 AND k.invalid_data='' AND s.invalid_data='' AND (k.valid_until IS NULL OR k.valid_until>=$2::date) AND (s.valid_until IS NULL OR s.valid_until>=$2::date)`,[id,manifest.snapshotDate]);
 await db.query('UPDATE knowledge.esklp_snapshots SET active=false WHERE active');await db.query('UPDATE knowledge.esklp_snapshots SET active=true WHERE id=$1',[id]);
 const links=(await db.query(`SELECT count(*)::int links,count(DISTINCT product_id)::int "linkedProducts",count(DISTINCT product_id) FILTER(WHERE match_status='name_difference')::int "productsWithNameDifference" FROM knowledge.esklp_product_links WHERE snapshot_id=$1`,[id])).rows[0];
 const noPdf=(await db.query(`SELECT count(DISTINCT l.product_id)::int n FROM knowledge.esklp_product_links l JOIN knowledge.products p ON p.id=l.product_id WHERE l.snapshot_id=$1 AND p.instruction_document_id IS NULL`,[id])).rows[0].n;
 await db.query(`INSERT INTO knowledge.sources(id,name,url,license,coverage,metadata,retrieved_at) VALUES('esklp','ЕСКЛП · СМНН и КЛП',$1,'Официальная пользовательская выгрузка; исходные документы и атрибуция сохранены.','Русская номенклатура, РУ, формы, дозировки и коды упаковок; не база взаимодействий и не двуязычный справочник.',$2,now()) ON CONFLICT(id) DO UPDATE SET coverage=EXCLUDED.coverage,metadata=EXCLUDED.metadata,retrieved_at=now()`,[manifest.url,JSON.stringify({...manifest,links:{...links,withoutPdf:noPdf},status:'loaded_excel_research'})]);
 await db.query('COMMIT');console.log(JSON.stringify({snapshot:manifest.snapshotDate,sourceCounts:manifest.counts,...links,linkedWithoutPdf:noPdf,englishTerms:0,ddiIdentitiesChanged:0,patientDataRead:false,patientDataWritten:false}));
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
