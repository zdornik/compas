// Display labels use the same explicit source IDs as the identity catalog.
// This function cannot promote a translation into an ingredient mapping.
export async function sourceDrugLabels(db,ids){
 if(!ids.length)return new Map();
 const rows=(await db.query(`SELECT p.external_id AS id,min(e.name_ru) AS name,count(DISTINCT e.name_ru)::int AS n FROM knowledge.provider_ingredients p JOIN knowledge.ingredient_entities e ON e.id=p.ingredient_id WHERE p.provider='ddinter' AND p.review_status='reviewed' AND e.review_status='reviewed' AND p.external_id=ANY($1::text[]) GROUP BY p.external_id`,[ids])).rows;
 const labels=new Map(rows.filter(row=>row.n===1).map(row=>[row.id,row.name]));
 // Exact bilingual dictionary labels are display-only and never feed the resolver.
 const missing=ids.filter(id=>!labels.has(id));
 if(missing.length){
  const terms=(await db.query(`SELECT d.id,min(t.name_ru) AS name,count(DISTINCT t.name_ru)::int AS n FROM knowledge.source_drugs d JOIN knowledge.inn_terms t ON lower(t.name_en)=lower(d.name) WHERE d.source_id='openmrs-ddinter' AND d.id=ANY($1::text[]) GROUP BY d.id`,[missing])).rows;
  for(const row of terms)if(row.n===1)labels.set(row.id,row.name);
 }
 return labels;
}
