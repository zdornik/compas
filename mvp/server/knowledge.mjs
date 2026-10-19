import {isEsklpCode,esklpCodeSearch,nsiNameSearch,esklpProduct} from './esklp.mjs';
import {referenceSearch} from './reference-search.mjs';
import {resolveIngredientMappings,providerPairs,findProviderInteractions} from './ingredient-identities.mjs';
// Public reference corpus only. No patient data or prescribing actions are handled here.
export const normalizeSearch = value => String(value || '').normalize('NFKC').replace(/\s+/gu,' ').trim().slice(0,160);
export function parseKnowledgeQuery(search) {
 const query=new URLSearchParams(search);
 const kind=query.get('kind') || 'clinical_recommendation';
 if(!['clinical_recommendation','drug_instruction','all'].includes(kind))throw Object.assign(new Error('Неизвестный тип документа'),{status:400});
 const numeric=(name,fallback,max)=>{const value=query.get(name);if(value===null)return fallback;if(!/^\d{1,8}$/.test(value))throw Object.assign(new Error('Некорректная страница'),{status:400});return Math.min(max,Number(value));};
 return {q:normalizeSearch(query.get('q')),kind,limit:Math.max(1,numeric('limit',20,100)),offset:numeric('offset',0,1000000),page:Math.max(1,numeric('page',1,10000)),allStatuses:query.get('allStatuses')==='1',psychiatryOnly:query.get('scope')==='psychiatry'};
}
export function assessInteractionCoverage({ loaded=0, mapped=0, selected=0, found=0 }={}) {
 if(!loaded)return {status:'not_checked',message:'База взаимодействий не загружена. Проверка не выполнена.',safeToCombine:null};
 if(mapped!==selected)return {status:'unmapped',message:'Не все выбранные препараты сопоставлены с источником взаимодействий. Проверка неполная.',safeToCombine:null};
 return {status:found?'potential_interactions':'no_records',message:found?'В источнике есть сведения о потенциальных взаимодействиях.':'В загруженной части источника сведений о паре не найдено. Это не подтверждает безопасность сочетания.',safeToCombine:null};
}
const fields=`d.id,d.mime_type AS "mimeType",d.kind,d.title,d.version,d.external_id AS "externalId",d.source_url AS "sourceUrl",d.landing_url AS "landingUrl",d.source_status AS "sourceStatus",d.icd10 AS "icd10",d.age_category AS "ageCategory",d.retrieved_at AS "retrievedAt",d.publication_date AS "publicationDate",d.review_status AS "reviewStatus",d.clinical_use_approved AS "clinicalUseApproved",d.metadata->>'extractionStatus' AS "extractionStatus"`;
const like=q=>'%'+q.replace(/[\\%_]/g,'\\$&')+'%';
export function createKnowledgeApi(pool) {
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 return async(req,res,pathname)=>{
  if(!pathname.startsWith('/api/knowledge/'))return false;
  if(req.method!=='GET'){json(res,405,{error:'Справочник доступен только для чтения'});return true;}
  try {
   const url=new URL(req.url,'http://localhost'), p=parseKnowledgeQuery(url.search);
   const suggestions=await referenceSearch(pool,pathname,url,p.q);if(suggestions){json(res,200,suggestions);return true;}
   if(pathname==='/api/knowledge/status'){
    const [stats,sources]=await Promise.all([
     pool.query(`SELECT (SELECT count(*)::int FROM knowledge.documents WHERE kind='clinical_recommendation') "clinicalDocuments",(SELECT count(*)::int FROM knowledge.documents WHERE kind='drug_instruction') "instructionDocuments",(SELECT count(*)::int FROM knowledge.pages) pages,(SELECT count(*)::int FROM knowledge.products) products,(SELECT count(*)::int FROM knowledge.substances) substances,(SELECT count(*)::int FROM knowledge.mentions) mentions,(SELECT count(*)::int FROM knowledge.interactions) interactions,
      (SELECT count(*)::int FROM knowledge.registry_compositions WHERE review_status='reviewed') "mappedSubstances",
      (SELECT count(*)::int FROM knowledge.substances WHERE name_en IS NOT NULL) "translatedSubstances",
      (SELECT count(*)::int FROM knowledge.inn_terms) "officialInnTerms",
      (SELECT count(*)::int FROM knowledge.nsi_drug_terms t JOIN knowledge.nsi_drug_snapshots z ON z.id=t.snapshot_id AND z.active) "nsiDrugTerms",
      (SELECT (manifest->'counts'->>'uniqueKlpCodes')::int FROM knowledge.esklp_snapshots WHERE active) "esklpKlpPositions",
      (SELECT count(DISTINCT d.id)::int FROM knowledge.documents d JOIN knowledge.product_documents x ON x.document_id=d.id JOIN knowledge.products p ON p.id=x.product_id WHERE p.metadata->>'collectionScope'='psychiatry') "psychiatryInstructions",
      (SELECT count(DISTINCT p.registration_number)::int FROM knowledge.products p WHERE p.metadata->>'collectionScope'='psychiatry') "psychiatryRegistrations",
      (SELECT count(DISTINCT p.registration_number)::int FROM knowledge.products p WHERE p.metadata->>'collectionScope'='psychiatry' AND p.instruction_document_id IS NOT NULL) "psychiatryRegistrationsReady"`),
     pool.query(`SELECT id,name,url,license,coverage,retrieved_at AS "retrievedAt", jsonb_build_object('snapshotDate',metadata->'snapshotDate','status',metadata->'status','instructionProgress',metadata->'instructionProgress','selectedTotal',metadata->'selectedTotal','catalogTotal',metadata->'catalogTotal','psychiatryScope',metadata->'psychiatryScope') metadata FROM knowledge.sources ORDER BY id`)
    ]);
    json(res,200,{counts:stats.rows[0],sources:sources.rows,clinicalUseApproved:false});return true;
   }
   if(pathname==='/api/knowledge/documents'){
    const values=[p.kind,p.q,like(p.q),p.limit,p.offset];
    const where=`($1='all' OR d.kind=$1) AND ($2='' OR d.title ILIKE $3 OR d.external_id ILIKE $3 OR EXISTS(SELECT 1 FROM unnest(d.icd10) AS code WHERE code ILIKE $3) OR EXISTS(SELECT 1 FROM knowledge.pages k WHERE k.document_id=d.id AND k.search_vector @@ plainto_tsquery('russian',$2)))`;
    const [rows,total]=await Promise.all([pool.query(`SELECT ${fields},(SELECT count(*)::int FROM knowledge.pages k WHERE k.document_id=d.id) AS "pageCount" FROM knowledge.documents d WHERE ${where} ORDER BY d.publication_date DESC NULLS LAST,d.title,d.id LIMIT $4 OFFSET $5`,values),pool.query(`SELECT count(*)::int n FROM knowledge.documents d WHERE ${where}`,values.slice(0,3))]);
    json(res,200,{items:rows.rows,total:total.rows[0].n,limit:p.limit,offset:p.offset});return true;
   }
   const asset=pathname.match(/^\/api\/knowledge\/documents\/([a-zA-Z0-9:_-]{1,100})\/assets\/([a-f0-9]{32})$/);
   if(asset){
    const result=await pool.query('SELECT original,mime_type FROM knowledge.page_assets WHERE document_id=$1 AND id=$2',[asset[1],asset[2]]);
    if(!result.rows.length){json(res,404,{error:'Фрагмент оригинала не найден'});return true;}
    const file=result.rows[0];res.writeHead(200,{'Content-Type':file.mime_type,'Content-Length':file.original.length,'Cache-Control':'no-store'});res.end(file.original);return true;
   }
   const document=pathname.match(/^\/api\/knowledge\/documents\/([a-zA-Z0-9:_-]{1,100})(?:\/(pages|pdf|mentions|reader))?$/);
   if(document){
    const id=document[1],action=document[2];
    if(action==='reader'){
     const exists=await pool.query('SELECT id FROM knowledge.documents WHERE id=$1',[id]);
     if(!exists.rows.length){json(res,404,{error:'Документ не найден'});return true;}
     const result=await pool.query('SELECT page,text_content AS text,layout FROM knowledge.pages WHERE document_id=$1 ORDER BY page',[id]);
     json(res,200,{pages:result.rows});return true;
    }
    if(action==='pdf'){
     const data=await pool.query('SELECT original,mime_type FROM knowledge.documents WHERE id=$1',[id]);
     if(!data.rows.length){json(res,404,{error:'Документ не найден'});return true;}
     const file=data.rows[0],extension=file.mime_type==='image/jpeg'?'jpg':file.mime_type==='image/png'?'png':'pdf';res.writeHead(200,{'Content-Type':file.mime_type,'Content-Length':file.original.length,'Content-Disposition':`inline; filename="${id.replace(/:/g,'-')}.${extension}"`,'Cache-Control':'no-store'});res.end(file.original);return true;
    }
    if(action==='pages'){
     const result=await pool.query(`SELECT page,text_content AS text FROM knowledge.pages WHERE document_id=$1 AND ($2='' OR search_vector @@ plainto_tsquery('russian',$2)) ORDER BY abs(page-$3),page LIMIT 1`,[id,p.q,p.page]);
     json(res,200,{item:result.rows[0]||null,query:p.q});return true;
    }
    if(action==='mentions'){
     const rows=await pool.query(`SELECT m.page,m.matched_text AS "matchedText",m.context,m.review_status AS "reviewStatus",s.id AS "substanceId",s.name_ru AS name FROM knowledge.mentions m JOIN knowledge.substances s ON s.id=m.substance_id WHERE m.document_id=$1 ORDER BY m.page,m.start_offset LIMIT $2 OFFSET $3`,[id,p.limit,p.offset]);
     json(res,200,{items:rows.rows,classification:'unreviewed_mention'});return true;
    }
    const result=await pool.query(`SELECT ${fields},d.metadata,(SELECT count(*)::int FROM knowledge.pages k WHERE k.document_id=d.id) AS "pageCount" FROM knowledge.documents d WHERE d.id=$1`,[id]);
    json(res,result.rows.length?200:404,result.rows[0]||{error:'Документ не найден'});return true;
   }
   if(pathname==='/api/knowledge/products'){
    const where=`($1='' OR search_vector @@ plainto_tsquery('russian',$1) OR trade_name ILIKE $2 OR inn ILIKE $2 OR EXISTS(SELECT 1 FROM knowledge.substances s WHERE s.id=substance_id AND s.name_en ILIKE $2) OR normalize(registration_number,NFKC) ILIKE $2 OR ${nsiNameSearch('substance_id')} ${isEsklpCode(p.q)?'OR '+esklpCodeSearch('id'):''}) AND (NOT $4 OR metadata->>'collectionScope'='psychiatry') AND ($3 OR source_status IN ('Действующий','Выдано по правилам ЕАЭС','Действует на подтверждении государственной регистрации','Действует в иностранных упаковках'))`;
    const values=[p.q,like(p.q),p.allStatuses,p.psychiatryOnly,p.limit,p.offset];
    const [rows,total]=await Promise.all([pool.query(`SELECT id,registration_number AS "registrationNumber",trade_name AS "tradeName",inn,form,source_status AS "sourceStatus",substance_id AS "substanceId",instruction_document_id AS "instructionDocumentId" FROM knowledge.products WHERE ${where} ORDER BY (instruction_document_id IS NOT NULL) DESC,trade_name,registration_number,id LIMIT $5 OFFSET $6`,values),pool.query(`SELECT count(*)::int n FROM knowledge.products WHERE ${where}`,values.slice(0,4))]);
    json(res,200,{items:rows.rows,total:total.rows[0].n,limit:p.limit,offset:p.offset});return true;
   }
   const product=pathname.match(/^\/api\/knowledge\/products\/(grls:[a-f0-9]{64})$/);
   if(product){
    const row=await pool.query(`SELECT id,registration_number AS "registrationNumber",trade_name AS "tradeName",inn,form,source_status AS "sourceStatus",substance_id AS "substanceId",instruction_document_id AS "instructionDocumentId",metadata FROM knowledge.products WHERE id=$1`,[product[1]]);
    if(!row.rows.length){json(res,404,{error:'Препарат не найден'});return true;}
    const item=row.rows[0];
    const [docs,mentions]=await Promise.all([pool.query(`SELECT ${fields},(SELECT count(*)::int FROM knowledge.pages k WHERE k.document_id=d.id) AS "pageCount" FROM knowledge.documents d JOIN knowledge.product_documents x ON x.document_id=d.id WHERE x.product_id=$1 ORDER BY d.title,d.version`,[item.id]),pool.query(`SELECT DISTINCT d.id,d.title,m.page,m.context,m.review_status AS "reviewStatus" FROM knowledge.mentions m JOIN knowledge.documents d ON d.id=m.document_id WHERE m.substance_id=$1 ORDER BY d.title,m.page LIMIT 15`,[item.substanceId])]);
    json(res,200,{...item,instructions:docs.rows,mentions:mentions.rows,identityMappings:await resolveIngredientMappings(pool,[item.substanceId]),esklp:await esklpProduct(pool,item.id)});return true;
   }
   if(pathname==='/api/knowledge/interactions'){
    const ids=[...new Set(url.searchParams.getAll('id'))];
    if(ids.length<2 || ids.length>10 || ids.some(id=>!/^grls:[a-f0-9]{64}$/.test(id))){json(res,400,{error:'Выберите от 2 до 10 препаратов из реестра'});return true;}
    const products=await pool.query('SELECT id,trade_name AS name,inn,substance_id AS "substanceId" FROM knowledge.products WHERE id=ANY($1::text[])',[ids]);
    if(products.rows.length!==ids.length){json(res,404,{error:'Один из выбранных препаратов отсутствует в реестре'});return true;}
    const loaded=Number((await pool.query('SELECT count(*) n FROM knowledge.interactions')).rows[0].n);
    const identityMappings=await resolveIngredientMappings(pool,products.rows.map(row=>row.substanceId));
    const mappingById=new Map(identityMappings.map(row=>[row.substanceId,row]));
    const productMappings=products.rows.map(row=>mappingById.get(row.substanceId)||{status:'unmapped',components:[]});
    const rows={rows:await findProviderInteractions(pool,providerPairs(productMappings))};
    const mappedCount=productMappings.filter(row=>row.status==='mapped').length;
    const terms=products.rows.flatMap(product=>products.rows.filter(other=>other.id!==product.id && other.inn!==product.inn).map(other=>({productId:product.id,inn:other.inn,productName:product.name,otherName:other.name})));
    const instructionMentions=terms.length ? await pool.query(`SELECT DISTINCT d.id AS "documentId",d.title,k.page,x."productName",x."otherName",x.inn AS "mentionedInn",d.source_url AS "sourceUrl",ts_headline('russian',k.text_content,plainto_tsquery('russian',x.inn),'MaxWords=65, MinWords=30') AS context
      FROM jsonb_to_recordset($1::jsonb) AS x("productId" text,inn text,"productName" text,"otherName" text)
      JOIN knowledge.product_documents link ON link.product_id=x."productId"
      JOIN knowledge.documents d ON d.id=link.document_id JOIN knowledge.pages k ON k.document_id=d.id
      WHERE length(x.inn)>2 AND k.search_vector @@ plainto_tsquery('russian',x.inn)
      LIMIT 20`,[JSON.stringify(terms)]) : {rows:[]};
    json(res,200,{...assessInteractionCoverage({loaded,mapped:mappedCount,selected:ids.length,found:rows.rows.length}),items:rows.rows,identityMappings,instructionMentions:instructionMentions.rows.map(row=>({...row,context:row.context.replace(/<\/?b>/g,''),classification:'unreviewed_text_match'})),products:products.rows,clinicalUseApproved:false});return true;
   }
   json(res,404,{error:'Раздел справочника не найден'});return true;
  }catch(error){json(res,error.status||503,{error:error.status?error.message:'Справочник пока недоступен. Повторите загрузку позже.'});return true;}
 };
}
