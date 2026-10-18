// Offline multilingual naming import. Does not approve any clinical source mapping.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const manifest=JSON.parse(await readFile('knowledge/eaeu-inn-manifest.json','utf8'));
const raw=await readFile('knowledge/processed/eaeu-inn.json'),terms=JSON.parse(raw);
if(manifest.status!=='complete'||hash(raw)!==manifest.sha256||terms.length!==manifest.records||new Set(terms.map(row=>row.code)).size!==terms.length)throw new Error('Incomplete EAEU snapshot');
for(const page of manifest.pages)if(hash(await readFile('knowledge/raw/eaeu/'+page.file))!==page.sha256)throw new Error('EAEU source hash mismatch');
for(const term of terms)if(!/^\d{6}$/.test(term.code)||['name_ru','name_en'].some(key=>typeof term[key]!=='string'||!term[key].trim()||term[key].length>500))throw new Error('Malformed EAEU term');
const pool=new pg.Pool({host:process.env.DB_HOST||'db',database:'compass',user:'compass_admin',password:(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim(),max:1}),db=await pool.connect();
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(2026101901)');
 await db.query(`INSERT INTO knowledge.sources(id,name,url,license,coverage,metadata,retrieved_at) VALUES('eaeu-inn','МНН ЕАЭС · русский / английский / латынь',$1,'Официальный публичный справочник ЕАЭС 1016; исходные условия сохраняются.','Названия для отображения и поиска; не автоматическое подтверждение ID базы взаимодействий.',$2,now()) ON CONFLICT(id) DO UPDATE SET metadata=EXCLUDED.metadata,retrieved_at=now()`,[manifest.sourceUrl,JSON.stringify(manifest)]);
 for(let i=0;i<terms.length;i+=1500)await db.query(`INSERT INTO knowledge.inn_terms(code,name_ru,name_en,name_la,metadata,source_id,source_sha256) SELECT code,name_ru,name_en,name_la,metadata,'eaeu-inn',$2 FROM jsonb_to_recordset($1::jsonb) AS t(code text,name_ru text,name_en text,name_la text,metadata jsonb) ON CONFLICT(code) DO UPDATE SET name_ru=EXCLUDED.name_ru,name_en=EXCLUDED.name_en,name_la=EXCLUDED.name_la,metadata=EXCLUDED.metadata,source_sha256=EXCLUDED.source_sha256`,[JSON.stringify(terms.slice(i,i+1500)),manifest.sha256]);
 // Names are for search/display only. Composition/provider review tables stay untouched.
 const updated=await db.query(`UPDATE knowledge.substances s SET name_en=t.name_en FROM (SELECT lower(name_ru) AS ru,min(name_en) AS name_en FROM knowledge.inn_terms GROUP BY lower(name_ru) HAVING count(DISTINCT lower(name_en))=1) t WHERE lower(s.name_ru)=t.ru AND s.name_en IS NULL`);
 await db.query('COMMIT');console.log(JSON.stringify({terms:terms.length,searchNamesAdded:updated.rowCount,providerIdentitiesApproved:0}));
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
