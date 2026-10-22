import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {buildGuidelineOutline,buildInstructionOutline,formatGuidelinePage,formatInstructionPage,findGuidelineMatches,normalizeReaderSearch} from '../src/guidelines.js';
import {matchesEtag} from './reference-files.mjs';
export const READER_VERSION=1;
export const hashJson=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function buildReaderIndex(document,pages,assets=[]){
 const outline=(document.kind==='drug_instruction'?buildInstructionOutline:buildGuidelineOutline)(pages),format=document.kind==='drug_instruction'?formatInstructionPage:formatGuidelinePage;
 const searchPages=[],entries=pages.map(page=>{
  const formatted=format(page,outline),blocks=formatted.blocks,figures=blocks.filter(block=>block.type==='figure');
  const quality=!page.text?.trim()?'scan':!page.layout?'plain_text':figures.some(block=>block.reason==='source_character_coverage_mismatch')?'source_image':figures.length?'mixed':'structured';
  searchPages.push({page:page.page,text:blocks.map(block=>normalizeReaderSearch(block.text)).join('\n')});
  return {page:page.page,revision:hashJson(page),characters:page.text.length,quality};
 });
 const body={version:READER_VERSION,sourceSha256:document.sha256,outline,pages:entries,assets:Object.fromEntries(assets.map(asset=>[asset.id,asset.sha256]))};
 return {manifest:{...body,revision:hashJson(body)},searchPages};
}
export async function publishReaderIndex(client,id){
 const document=(await client.query('SELECT id,kind,sha256 FROM knowledge.documents WHERE id=$1',[id])).rows[0];if(!document)throw new Error('Document not found');
 const pages=(await client.query('SELECT page,text_content AS text,layout FROM knowledge.pages WHERE document_id=$1 ORDER BY page',[id])).rows;
 const assets=(await client.query('SELECT id,sha256 FROM knowledge.page_assets WHERE document_id=$1 ORDER BY id',[id])).rows;
 const {manifest,searchPages}=buildReaderIndex(document,pages,assets);
 await client.query(`UPDATE knowledge.pages p SET reader_search=x.text FROM jsonb_to_recordset($2::jsonb) AS x(page integer,text text) WHERE p.document_id=$1 AND p.page=x.page AND p.reader_search IS DISTINCT FROM x.text`,[id,JSON.stringify(searchPages)]);
 await client.query(`INSERT INTO knowledge.reader_indexes(document_id,source_sha256,revision,manifest) VALUES($1,$2,$3,$4) ON CONFLICT(document_id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,revision=EXCLUDED.revision,manifest=EXCLUDED.manifest,published_at=now() WHERE knowledge.reader_indexes.revision<>EXCLUDED.revision`,[id,document.sha256,manifest.revision,JSON.stringify(manifest)]);
 return manifest;
}
export function referenceJson(req,res,value,{revision,immutable=false}={}){
 const raw=Buffer.from(JSON.stringify(value)),etag='W/"'+(revision||hashJson(value))+'"';
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':immutable?'public, max-age=31536000, immutable':revision?'public, no-cache':'no-store','Vary':'Accept-Encoding',...(revision?{ETag:etag}:{})};
 if(revision&&matchesEtag(req.headers?.['if-none-match'],etag)){res.writeHead(304,headers);res.end();return;}
 const accept=String(req.headers?.['accept-encoding']||'');
 // A weak validator covers the equivalent compressed and uncompressed JSON.
 if(/(?:^|,)\s*gzip(?:\s*;\s*q=(?!0(?:\.0*)?(?:\s|,|$))[\d.]+)?\s*(?:,|$)/i.test(accept)&&raw.length>1024){headers['Content-Encoding']='gzip';const compressed=gzipSync(raw);headers['Content-Length']=compressed.length;res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:compressed);}
 else{headers['Content-Length']=raw.length;res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:raw);}
}
async function readerRoute(pool,req,res,id,action,url){
 const row=(await pool.query(`SELECT i.manifest,i.revision,d.kind FROM knowledge.reader_indexes i JOIN knowledge.documents d ON d.id=i.document_id AND d.sha256=i.source_sha256 WHERE i.document_id=$1`,[id])).rows[0];
 if(!row)throw Object.assign(new Error('Текстовый индекс ещё не подготовлен'),{status:409});
 const version=url.searchParams.get('v');if(version!==null&&version!==row.revision)throw Object.assign(new Error('Версия документа изменилась. Откройте документ заново.'),{status:409});
 if(action==='reader-index'){referenceJson(req,res,row.manifest,{revision:row.revision});return;}
 if(action==='reader-search'){
  const q=(url.searchParams.get('q')||'').trim().slice(0,160),needle=normalizeReaderSearch(q);
  if(needle.length<2){referenceJson(req,res,{items:[],total:0,pageCount:0,truncated:false});return;}
  const pages=(await pool.query(`SELECT page,text_content AS text,layout FROM knowledge.pages WHERE document_id=$1 AND strpos(reader_search,$2)>0 ORDER BY page`,[id,needle])).rows;
  const format=row.kind==='drug_instruction'?formatInstructionPage:formatGuidelinePage;
  referenceJson(req,res,findGuidelineMatches(pages.map(page=>format(page,row.manifest.outline)),q));return;
 }
 const from=url.searchParams.get('from'),limit=url.searchParams.get('limit')||'5';
 if(!/^[1-9]\d{0,4}$/.test(from||'')||!/^[1-9]\d?$/.test(limit)||Number(limit)>10)throw Object.assign(new Error('Некорректный диапазон страниц'),{status:400});
 const pages=(await pool.query('SELECT page,text_content AS text,layout FROM knowledge.pages WHERE document_id=$1 AND page>=$2 AND page<$3 ORDER BY page',[id,Number(from),Number(from)+Number(limit)])).rows;
 referenceJson(req,res,{pages,revision:row.revision},{revision:hashJson([row.revision,from,limit]),immutable:version===row.revision});
}

export async function readReaderRoute(pool,req,res,id,action,url){
 const client=await pool.connect();
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await readerRoute(client,req,res,id,action,url);await client.query('COMMIT');}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
