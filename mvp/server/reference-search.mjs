import {searchConditions} from './condition-search.mjs';
const like=value=>'%'+value.replace(/[\\%_]/g,'\\$&')+'%';
const productFields=`p.id,p.registration_number AS "registrationNumber",p.trade_name AS "tradeName",p.inn,p.form,p.substance_id AS "substanceId",p.instruction_document_id AS "instructionDocumentId",p.metadata->>'holder' AS holder`;
const active=`p.form !~* 'субстанц' AND p.source_status IN ('Действующий','Выдано по правилам ЕАЭС','Действует на подтверждении государственной регистрации','Действует в иностранных упаковках')`;
export async function referenceSearch(db,path,url,q){
 if(path==='/api/knowledge/conditions')return searchConditions(db,q);
 if(path==='/api/knowledge/suggestions'){
  if(q.length<2)return {substances:[],products:[]};
  const [substances,products]=await Promise.all([
   db.query(`SELECT s.id,s.name_ru AS name,s.name_en AS "nameEn",count(*)::int AS "productCount",count(p.instruction_document_id)::int AS "readyCount" FROM knowledge.substances s JOIN knowledge.products p ON p.substance_id=s.id WHERE ${active} AND (s.name_ru ILIKE $2 OR s.name_en ILIKE $2) GROUP BY s.id ORDER BY (lower(s.name_ru)=lower($1) OR lower(s.name_en)=lower($1)) DESC,count(p.instruction_document_id) DESC,s.name_ru LIMIT 6`,[q,like(q)]),
   db.query(`SELECT ${productFields} FROM knowledge.products p WHERE ${active} AND (p.trade_name ILIKE $2 OR normalize(p.registration_number,NFKC) ILIKE $2) ORDER BY (p.instruction_document_id IS NOT NULL) DESC,(lower(p.trade_name)=lower($1)) DESC,p.trade_name,p.registration_number,p.id LIMIT 8`,[q,like(q)])]);
  return {substances:substances.rows,products:products.rows};
 }
 if(path==='/api/knowledge/substance-products'){
  const id=url.searchParams.get('id');if(!/^inn:[a-f0-9]{24}$/.test(id||''))throw Object.assign(new Error('Некорректное МНН'),{status:400});
  return {items:(await db.query(`SELECT ${productFields} FROM knowledge.products p WHERE p.substance_id=$1 AND ${active} ORDER BY (p.instruction_document_id IS NOT NULL) DESC,p.trade_name,p.registration_number,p.id LIMIT 100`,[id])).rows};
 }
 return null;
}
