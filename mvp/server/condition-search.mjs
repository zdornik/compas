// Search synonyms only: selecting a confirmed diagnosis remains an explicit user action.
// These aliases do not set a diagnosis or join the drug-disease knowledge base.
const aliases=[
 {names:['гипертония','артериальная гипертония','гипертоническая болезнь'],term:'гипертенз',preferred:['I10','I11','I12','I13','I15']},
 {names:['бар','биполярка','биполярное расстройство'],term:'биполяр',preferred:['F31']},
 {names:['окр','обсессивно компульсивное расстройство'],term:'обсессивно',preferred:['F42']},
 {names:['сд1','сд 1','диабет 1 типа','диабет первого типа'],term:'диабет',preferred:['E10']},
 {names:['сд2','сд 2','диабет 2 типа','диабет второго типа'],term:'диабет',preferred:['E11']},
 {names:['депрессия','депрессивное расстройство'],term:'депрессив',preferred:['F32','F33']},
 {names:['мигрень'],term:'мигрень',preferred:['G43']},
 {names:['астма','бронхиальная астма'],term:'астма',preferred:['J45']},
 {names:['хбп','хроническая болезнь почек'],term:'хроническая болезнь почек',preferred:['N18']},
 {names:['хпн','хроническая почечная недостаточность'],term:'почечная недостаточность',preferred:['N18']},
 {names:['гипотиреоз'],term:'гипотиреоз',preferred:['E03']},
];
const common=['I10','E11','E10','J45','G40','F31','F32','F33','F41','F42','N18','E03','I25','I48','G43','K21','E66','E78'];
const fold=value=>value.toLowerCase().replace(/ё/g,'е').replace(/[-–—.,]/g,' ').replace(/\s+/g,' ').trim();
const like=value=>'%'+value.replace(/[\\%_]/g,'\\$&')+'%';
export function conditionSearchIntent(query){
 const normalized=fold(query),alias=aliases.find(row=>row.names.some(name=>normalized===name||(normalized.length>=4&&name.startsWith(normalized))));
 return {query,term:alias?.term||query,preferred:alias?.preferred||[],matchedAlias:alias?query:null,specificAge:/новорожден|неонат|перинат|врожден|ребен|детск|плод|беремен|родов|^[pq]\d/i.test(normalized)};
}
export async function searchConditions(db,query){
 const intent=conditionSearchIntent(query),values=[query,like(intent.term),intent.term,intent.preferred,common,intent.specificAge,query.replace(/[\\%_]/g,'\\$&')+'%'];
 const result=await db.query(`SELECT code,name_ru AS name,source_version AS "sourceVersion" FROM knowledge.conditions
 WHERE ($1='' AND code=ANY($5::text[])) OR ($1<>'' AND (code ILIKE $7 OR name_ru ILIKE $2 OR search_vector @@ plainto_tsquery('russian',$3) OR code=ANY($4::text[])))
 ORDER BY (upper(code)=upper($1)) DESC,
 (CASE WHEN $6 OR NOT (code ~ '^[PQO]' OR name_ru ~* '(новорожден|неонат|перинат|беременн|врожденн)') THEN 0 ELSE 500 END
  -CASE WHEN code=ANY($4::text[]) THEN 200-coalesce(array_position($4::text[],code),0) ELSE 0 END
  -CASE WHEN code=ANY($5::text[]) THEN 60 ELSE 0 END
  -CASE WHEN length(code)=3 THEN 25 ELSE 0 END
  -CASE WHEN lower(name_ru)=lower($1) THEN 40 ELSE 0 END),length(code),name_ru,code LIMIT 14`,values);
 return {items:result.rows,matchedAlias:intent.matchedAlias,source:'МКБ-10 · НСИ 2.27 (зеркало)',latestVersionVerified:false};
}
