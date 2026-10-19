// Public read models live in the same PostgreSQL database as their source data.
// This module contains no patient cache or medical-identity matching decisions.
import {isEsklpCode,esklpCodeSearch} from './esklp.mjs';
const like=q=>'%'+q.replace(/[\\%_]/g,'\\$&')+'%';
export const catalogProductFields=`p.id,p.registration_number AS "registrationNumber",p.trade_name AS "tradeName",p.inn,p.form,p.source_status AS "sourceStatus",p.substance_id AS "substanceId",p.instruction_document_id AS "instructionDocumentId"`;
export const catalogSuggestionFields=catalogProductFields.replace(',p.source_status AS "sourceStatus"','')+',p.holder';
const order=`p.has_instruction DESC,p.trade_name,p.registration_number,p.id`;
export function catalogCandidates(q){
 return `SELECT id FROM knowledge.catalog_products WHERE search_vector @@ plainto_tsquery('russian',$1)
 UNION SELECT id FROM knowledge.catalog_products WHERE trade_name ILIKE $2
 UNION SELECT id FROM knowledge.catalog_products WHERE inn ILIKE $2
 UNION SELECT id FROM knowledge.catalog_products WHERE registration_search ILIKE $2
 UNION SELECT p.id FROM knowledge.catalog_products p JOIN (SELECT DISTINCT substance_id FROM knowledge.catalog_terms WHERE kind<>'registry_ru' AND term ILIKE $2) t ON t.substance_id=p.substance_id
 ${isEsklpCode(q)?'UNION SELECT id FROM knowledge.catalog_products WHERE '+esklpCodeSearch('id'):''}`;
}
export async function searchCatalogProducts(db,p){
 const filters=`(NOT $4 OR p.psychiatry) AND ($3 OR p.active)`,values=[p.q,like(p.q),p.allStatuses,p.psychiatryOnly,p.limit,p.offset];
 const matched=p.q?`candidates AS (${catalogCandidates(p.q)}),matched AS MATERIALIZED (SELECT p.id FROM knowledge.catalog_products p JOIN candidates c ON c.id=p.id WHERE ${filters}),`:'';
 const from=p.q?'JOIN matched m ON m.id=p.id':'',total=p.q?'(SELECT count(*)::int FROM matched)':`(SELECT (totals->>(CASE WHEN $4 THEN CASE WHEN $3 THEN 'psychiatry' ELSE 'psychiatryActive' END ELSE CASE WHEN $3 THEN 'all' ELSE 'active' END END))::int FROM knowledge.catalog_state WHERE singleton)`;
 const sql=`WITH input AS (SELECT $1::text q,$2::text pattern),${matched} limited AS MATERIALIZED (SELECT ${catalogProductFields} FROM knowledge.catalog_products p ${from} WHERE ${filters} ORDER BY ${order} LIMIT $5 OFFSET $6)
 SELECT coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY (i."instructionDocumentId" IS NOT NULL) DESC,i."tradeName",i."registrationNumber",i.id) FROM limited i),'[]'::jsonb) items,${total} total`;
 const row=(await db.query(sql,values)).rows[0];if(!row||row.total===null)throw new Error('Reference catalog not published');return {...row,limit:p.limit,offset:p.offset};
}
export async function catalogSuggestions(db,q){
 if(q.length<2)return {substances:[],products:[]};
 const values=[q,like(q)];
 const results=await Promise.all([
  db.query(`SELECT s.id,s.name_ru AS name,s.name_en AS "nameEn",s.product_count AS "productCount",s.ready_count AS "readyCount" FROM knowledge.catalog_substances s WHERE s.product_count>0 AND s.id IN (SELECT substance_id FROM knowledge.catalog_terms WHERE term ILIKE $2) ORDER BY (lower(s.name_ru)=lower($1) OR lower(s.name_en)=lower($1)) DESC,s.ready_count DESC,s.name_ru LIMIT 6`,values),
  db.query(`SELECT ${catalogSuggestionFields} FROM knowledge.catalog_products p WHERE p.selectable AND (p.trade_name ILIKE $2 OR p.registration_search ILIKE $2 ${isEsklpCode(q)?'OR '+esklpCodeSearch('p.id'):''}) ORDER BY p.has_instruction DESC,(lower(p.trade_name)=lower($1)) DESC,p.trade_name,p.registration_number,p.id LIMIT 8`,values)
 ]);
 return {substances:results[0].rows,products:results[1].rows};
}
export async function catalogSubstanceProducts(db,id){return {items:(await db.query(`SELECT ${catalogSuggestionFields} FROM knowledge.catalog_products p WHERE p.substance_id=$1 AND p.selectable ORDER BY ${order} LIMIT 100`,[id])).rows};}
