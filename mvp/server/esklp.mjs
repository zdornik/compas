// These lookups enrich public nomenclature. They never grant a provider identity.
export const isEsklpCode=value=>/^\d{2}\.\d{2}\.\d{2}\.\d{3}-\d{6}-\d-\d{5}-\d{13}$/.test(value);
export const esklpCodeSearch=(productId,parameter='$1')=>`${productId} IN (SELECT l.product_id FROM knowledge.esklp_product_links l JOIN knowledge.esklp_snapshots z ON z.id=l.snapshot_id AND z.active WHERE l.klp_code=${parameter} OR l.smnn_code=${parameter})`;
export const nsiNameSearch=(substanceId,pattern='$2')=>`${substanceId} IN (SELECT l.substance_id FROM knowledge.nsi_substance_terms l JOIN knowledge.nsi_drug_terms t ON t.snapshot_id=l.snapshot_id AND t.code=l.term_code JOIN knowledge.nsi_drug_snapshots z ON z.id=t.snapshot_id AND z.active WHERE t.name_en ILIKE ${pattern} OR t.name_la ILIKE ${pattern} OR t.name_la_genitive ILIKE ${pattern} OR EXISTS(SELECT 1 FROM unnest(t.alternatives) a WHERE a ILIKE ${pattern}))`;
export async function esklpProduct(db,productId){
 const totals=(await db.query(`SELECT count(*)::int total,min(z.snapshot_date)::text AS "snapshotDate" FROM knowledge.esklp_product_links l JOIN knowledge.esklp_snapshots z ON z.id=l.snapshot_id AND z.active WHERE l.product_id=$1`,[productId])).rows[0];
 if(!totals?.total)return null;
 const rows=(await db.query(`SELECT DISTINCT ON(k.code) k.code AS "klpCode",k.smnn_code AS "smnnCode",k.normalized_inn AS "normalizedInn",k.form,k.dosage,k.workbook AS "sourceWorkbook",k.source_row AS "sourceRow",l.match_status AS "matchStatus" FROM knowledge.esklp_product_links l JOIN knowledge.esklp_snapshots z ON z.id=l.snapshot_id AND z.active JOIN knowledge.esklp_klp k ON k.snapshot_id=l.snapshot_id AND k.code=l.klp_code WHERE l.product_id=$1 ORDER BY k.code,k.workbook,k.source_row LIMIT 100`,[productId])).rows;
 return {...totals,records:rows,sourceUrl:'https://esklp.egisz.rosminzdrav.ru/',identityEvidenceOnly:true,clinicalUseApproved:false};
}
