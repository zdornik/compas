import {normalizeReferenceText,sourceSentenceForHit} from '../src/reference-text.js';
import {currentMedicationRows} from '../src/current-medications.js';
import {findDiseaseInteractions} from './disease-safety.mjs';
import { createHash } from 'node:crypto';
import {resolveIngredientMappings,providerPairs,findProviderInteractions} from './ingredient-identities.mjs';
import {stageForDay} from '../src/medications.js';
const headings=[['Противопоказания',/^(?:\d+[.)]?\s*)?противопоказания(?:\s|[:.]|$)/iu],['С осторожностью',/^с\s+осторожностью(?:\s|[:.]|$)/iu],['Особые указания',/^(?:\d+[.)]?\s*)?особые\s+указания(?:\s|[:.]|$)/iu],['Взаимодействия',/^(?:\d+[.)]?\s*)?(?:взаимодействи[ея]\s+с\s+другими|другие\s+(?:лекарственные\s+)?препараты\s+и\s+)/iu]];
const stop=/^(?:\d+[.)]?\s*)?(?:показания\s+к|способ\s+применения|режим\s+дозирования|побочн|нежелательные\s+реакции|передозировка|особые\s+указания|фармако|применение\s+при\s+беременности|беременность|влияние\s+на|условия\s+хранения|срок\s+годности|форма\s+выпуска|как\s+принимать|о\s+чем\s+следует|возможные\s+нежелательные)/iu;
export function safetyExcerpt(marked) {
 const marker='__COMPASS_HIT__',hit=marked.indexOf(marker);
 if(hit<0)return marked.slice(0,1800);
 const bullet=marked.lastIndexOf('•',hit),nextBullet=marked.indexOf('•',hit+marker.length);
 let start=bullet>=0&&hit-bullet<1200?bullet:Math.max(0,marked.lastIndexOf('\n\n',hit));
 if(hit-start>1200){const before=Math.max(0,hit-450);start=marked.lastIndexOf('\n',before)+1;}
 let end=nextBullet>=0?nextBullet:marked.length;
 if(end-start>1800)end=Math.min(marked.length,hit+1000);
 return (start?'…\n':'')+marked.slice(start,end).replaceAll(marker,'').trim()+(end<marked.length?'\n…':'');
}
// Search excerpts only. This deliberately does not interpret negation, severity or contraindications.
export function instructionSafetySections(pages) {
 const sections=[];let kind=null;
 for(const page of pages){let buffer=[];const flush=()=>{if(kind&&buffer.join(' ').trim())sections.push({page:page.page,kind,text:buffer.join('\n')});buffer=[];};
  for(const line of normalizeReferenceText(page.text).split('\n')){const heading=headings.find(([,pattern])=>pattern.test(line.trim()));if(heading&&line.trim().length<180){flush();kind=heading[0];}else if(line.trim().length<150&&stop.test(line.trim())){flush();kind=null;}if(kind)buffer.push(line);}
  flush();
 }
 return sections;
}
export async function prescriptionSafety(db,{entries,productId,documentId,excludePlanId=null,proposedConfig=null}) {
 const profile=entries.find(row=>row.type==='medical-profile');
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
 const current=currentMedicationRows(entries.filter(row=>row.id!==excludePlanId),profile,today).map(({plan,...row})=>row);
 const productsIds=[...new Set([productId,...current.map(row=>row.productId)].filter(Boolean))];
 const products=productsIds.length?(await db.query('SELECT id,trade_name,inn,substance_id FROM knowledge.products WHERE id=ANY($1::text[])',[productsIds])).rows:[];
 const candidate=products.find(row=>row.id===productId);
 if(productId&&!candidate)throw Object.assign(new Error('Препарат не найден в реестре'),{status:422});
 let document=null,pages=[];
 if(candidate&&documentId){document=(await db.query(`SELECT d.id,d.title,d.version,d.source_url,d.sha256 FROM knowledge.documents d JOIN knowledge.product_documents x ON x.document_id=d.id WHERE x.product_id=$1 AND d.id=$2`,[productId,documentId])).rows[0]||null;
  if(!document)throw Object.assign(new Error('Выберите инструкцию именно этого регистрационного удостоверения'),{status:422});
  pages=(await db.query('SELECT page,text_content AS text FROM knowledge.pages WHERE document_id=$1 ORDER BY page',[documentId])).rows;
 }
 const sections=instructionSafetySections(pages);
 const terms=[...current.map(row=>({id:row.id,kind:'medication',name:row.name,term:products.find(p=>p.id===row.productId)?.inn||row.name})),...(profile?.conditions||[]).map(row=>({id:row.id,kind:'condition',name:row.name,term:row.name}))];
 let findings=[];
 if(sections.length&&terms.length){findings=(await db.query(`SELECT s.page,s.kind AS section,t.id,t.kind,t.name,t.term,s.text AS "fullContext",ts_headline('russian',s.text,phraseto_tsquery('russian',t.term),'StartSel=__COMPASS_HIT__,StopSel=__COMPASS_HIT__,HighlightAll=true') AS context FROM jsonb_to_recordset($1::jsonb) AS s(page int,kind text,text text) CROSS JOIN jsonb_to_recordset($2::jsonb) AS t(id text,kind text,name text,term text) WHERE length(t.term)>2 AND to_tsvector('russian',s.text) @@ phraseto_tsquery('russian',t.term) ORDER BY s.page,t.id LIMIT 30`,[JSON.stringify(sections),JSON.stringify(terms)])).rows.map(row=>({...row,context:sourceSentenceForHit(row.context),documentId:document.id,sourceUrl:document.source_url,documentTitle:document.title,status:'instruction_text_match'}));}
 const duplicates=current.filter(row=>candidate&&products.find(p=>p.id===row.productId)?.substance_id===candidate.substance_id).map(row=>({name:row.name,inn:candidate.inn,status:'same_registry_inn'}));
 const loaded=Number((await db.query('SELECT count(*) n FROM knowledge.interactions')).rows[0].n);
 const ids=[...new Set(products.map(row=>row.substance_id).filter(Boolean))];
 const identityMappings=await resolveIngredientMappings(db,ids);
 const mapped=new Set(identityMappings.filter(row=>row.status==='mapped').map(row=>row.substanceId));
 const candidateMapping=identityMappings.find(row=>row.substanceId===candidate?.substance_id);
 const otherMappings=identityMappings.filter(row=>row.substanceId!==candidate?.substance_id);
 const interactions=candidateMapping?await findProviderInteractions(db,otherMappings.flatMap(row=>providerPairs([candidateMapping,row]))):[];
 const disease=await findDiseaseInteractions(db,candidateMapping,profile?.conditions||[]);
 const report={diseaseInteractions:disease.items,status:'incomplete',safeToCombine:null,checkedAt:new Date().toISOString(),profileRevision:profile?.revision||0,currentMedications:current,conditions:profile?.conditions||[],identityMappings,candidate:candidate?{id:candidate.id,name:candidate.trade_name,inn:candidate.inn}:null,document:document?{id:document.id,title:document.title,version:document.version,sourceUrl:document.source_url,sha256:document.sha256}:null,findings,duplicates,interactions,coverage:{ddinter:{status:loaded?'partial':'unavailable',loadedPairs:loaded,mappedSubstances:mapped.size,requiredSubstances:ids.length},instruction:{status:sections.length?'sections_searched':document?'no_searchable_sections':'not_selected',searchedSections:sections.length,textPages:pages.filter(row=>row.text.trim().length>100).length,totalPages:pages.length},diseases:disease.coverage},limitations:['Совпадение в тексте не устанавливает противопоказание: проверьте контекст, отрицания и условия в оригинале.','Поиск не охватывает синонимы, классы препаратов, все диагнозы, возраст, беременность, дозировки и все версии инструкций.','Отсутствие совпадений или пары в базе не подтверждает безопасность.']};
 report.unmappedMedicationNames=current.filter(row=>!products.some(product=>product.id===row.productId)).map(row=>row.name);
 const basis={version:3,diseaseInteractions:disease.items,proposedConfig,identityMappings,productId:productId||null,documentId:documentId||null,excludePlanId,profile:profile||null,plans:entries.filter(row=>row.type==='medication-plan').sort((a,b)=>a.id.localeCompare(b.id)),documentSha:document?.sha256||null,findings,interactions,coverage:report.coverage};
 report.fingerprint=createHash('sha256').update(JSON.stringify(basis)).digest('hex');return report;
}
