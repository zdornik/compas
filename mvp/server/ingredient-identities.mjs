import {sourceDrugLabels} from './reference-labels.mjs';
// Resolution is by reviewed identities, never translation, transliteration, ATC alone or fuzzy names.
export function evaluateIngredientMapping(substanceId,rows) {
 const present=rows.filter(row=>row.ingredientId);
 const components=new Map();
 for(const row of present){if(!components.has(row.ingredientId))components.set(row.ingredientId,[]);components.get(row.ingredientId).push(row);}
 const expected=Number(rows[0]?.expectedComponents||0);
 const complete=rows[0]?.compositionStatus==='reviewed'&&expected>0&&components.size===expected;
 const items=[...components.values()].map(group=>{
  const row=group[0],links=group.filter(item=>item.providerStatus==='reviewed'&&item.externalId);
  const identityReviewed=Boolean(row.nameRu?.trim()&&row.nameEn?.trim())&&row.identityStatus==='reviewed'&&row.componentStatus==='reviewed'&&['exact','reviewed_active_moiety'].includes(row.relation);
  const resolved=identityReviewed&&links.length===1;
  return {ingredientId:row.ingredientId,nameRu:row.nameRu,nameEn:row.nameEn,chemicalForm:row.chemicalForm,relation:row.relation,status:resolved?'reviewed_ddinter_mapping':'unmapped',providerId:resolved?links[0].externalId:null,providerName:resolved?links[0].externalName||null:null,reason:!identityReviewed?'identity_or_form_unreviewed':links.length!==1?'provider_link_missing_or_ambiguous':null};
 });
 const review=rows[0],blocked=review?.manualProviderStatus&&review.manualProviderStatus!=='linked';
 return {substanceId,nameRu:review?.registryName||null,nameEn:review?.registryNameEn||items[0]?.nameEn||null,officialTermCode:review?.officialTermCode||null,officialNames:review?.nsiTerms||[],translationKind:review?.translationKind||(review?.officialTermCode?'official_inn':null),manualProviderStatus:review?.manualProviderStatus||null,reviewNote:review?.reviewNote||null,reviewSources:(review?.reviewEvidence||[]).flatMap(e=>e.url||e.sourceUrl?[{url:e.url||e.sourceUrl,kind:e.kind}]:[]),status:!blocked&&complete&&items.every(item=>item.providerId)?'mapped':'unmapped',compositionReviewed:complete,expectedComponents:expected,components:items,reason:blocked?review.manualProviderStatus:!complete?'composition_incomplete_or_unreviewed':items.some(item=>!item.providerId)?'component_not_mapped':null};
}
export async function resolveIngredientMappings(db,substanceIds) {
 const ids=[...new Set(substanceIds.filter(Boolean))];if(!ids.length)return [];
 const result=await db.query(`SELECT s.id AS "substanceId",s.name_ru AS "registryName",s.name_en AS "registryNameEn",t.code AS "officialTermCode",n.terms AS "nsiTerms",m.translation_kind AS "translationKind",m.provider_status AS "manualProviderStatus",m.note AS "reviewNote",m.evidence AS "reviewEvidence",c.expected_components AS "expectedComponents",c.review_status AS "compositionStatus",e.id AS "ingredientId",e.name_ru AS "nameRu",e.name_en AS "nameEn",e.review_status AS "identityStatus",r.chemical_form AS "chemicalForm",r.relation,r.review_status AS "componentStatus",p.external_id AS "externalId",p.external_name AS "externalName",p.review_status AS "providerStatus" FROM knowledge.substances s LEFT JOIN LATERAL (SELECT min(code) AS code FROM knowledge.inn_terms WHERE lower(name_ru)=lower(s.name_ru) HAVING count(DISTINCT lower(name_en))=1) t ON true LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('code',t.code,'version',t.version,'nameRu',t.name_ru,'nameEn',t.name_en,'nameLa',t.name_la,'relation',l.relation,'group',t.group_code) ORDER BY t.code) AS terms FROM knowledge.nsi_substance_terms l JOIN knowledge.nsi_drug_terms t ON t.snapshot_id=l.snapshot_id AND t.code=l.term_code JOIN knowledge.nsi_drug_snapshots z ON z.id=t.snapshot_id AND z.active WHERE l.substance_id=s.id) n ON true LEFT JOIN knowledge.manual_ingredient_reviews m ON m.substance_id=s.id LEFT JOIN knowledge.registry_compositions c ON c.substance_id=s.id LEFT JOIN knowledge.registry_components r ON r.substance_id=s.id LEFT JOIN knowledge.ingredient_entities e ON e.id=r.ingredient_id LEFT JOIN knowledge.provider_ingredients p ON p.ingredient_id=e.id AND p.provider='ddinter' WHERE s.id=ANY($1::text[]) ORDER BY s.id,e.id,p.external_id`,[ids]);
 return ids.map(id=>evaluateIngredientMapping(id,result.rows.filter(row=>row.substanceId===id)));
}
export function providerPairs(groups) {
 const pairs=new Map();
 for(let a=0;a<groups.length;a++)for(let b=a+1;b<groups.length;b++){
  const left=groups[a].status==='mapped'?groups[a].components:[],right=groups[b].status==='mapped'?groups[b].components:[];
  for(const x of left)for(const y of right)if(x.providerId&&y.providerId&&x.providerId!==y.providerId){const pair=[x.providerId,y.providerId].sort();pairs.set(pair.join('\u0000'),{a:pair[0],b:pair[1]});}
 }
 return [...pairs.values()];
}
export async function findProviderInteractions(db,pairs) {
 if(!pairs.length)return [];
 const rows=(await db.query(`SELECT DISTINCT i.id,i.source_drug_a_id AS "drugAId",i.source_drug_b_id AS "drugBId",i.drug_a_name AS "drugAName",i.drug_b_name AS "drugBName",i.source_severity AS severity,i.source_severity AS "sourceSeverity",i.mechanism,i.management,i.source_url AS "sourceUrl",i.review_status AS "reviewStatus" FROM knowledge.interactions i JOIN jsonb_to_recordset($1::jsonb) AS p(a text,b text) ON i.source_drug_a_id=p.a AND i.source_drug_b_id=p.b WHERE i.source_id IN ('ddinter','openmrs-ddinter') ORDER BY i.id`,[JSON.stringify(pairs)])).rows;
 const labels=await sourceDrugLabels(db,[...new Set(rows.flatMap(row=>[row.drugAId,row.drugBId]))]);
 return rows.map(row=>({...row,drugANameRu:labels.get(row.drugAId)||null,drugBNameRu:labels.get(row.drugBId)||null}));
}
