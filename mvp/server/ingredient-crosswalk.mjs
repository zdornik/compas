// Source identity matching, never a translated trade name or an approximate search.
export const identityName=value=>String(value||'').normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
const compound=value=>/[+\/;\[\]]/u.test(value)||/\band\b/iu.test(value);
export function buildInnCrosswalk(substances,terms,drugs,reviewed=[]){
 const byRu=new Map(),byEn=new Map(),existing=new Set(reviewed.map(row=>identityName(row.nameRu)));
 for(const term of terms){const name=identityName(term.name_ru);if(!byRu.has(name))byRu.set(name,[]);byRu.get(name).push(term);}
 for(const drug of drugs){const name=identityName(drug.name);if(!byEn.has(name))byEn.set(name,[]);byEn.get(name).push(drug);}
 const links=[],gaps=[];
 for(const substance of substances){
  if(existing.has(identityName(substance.nameRu)))continue;
  const found=byRu.get(identityName(substance.nameRu))||[],english=[...new Set(found.map(t=>identityName(t.name_en)))];
  const gap=(reason,nameEn=english.length===1?english[0]:null)=>gaps.push({substanceId:substance.id,nameRu:substance.nameRu,nameEn,reason});
  if(compound(substance.nameRu)){gap('composition_requires_component_review');continue;}
  if(english.length!==1||!english[0]){gap(english.length?'official_translation_ambiguous':'official_translation_missing');continue;}
  const nameEn=english[0];if(compound(nameEn)){gap('composition_requires_component_review');continue;}
  const providers=byEn.get(nameEn)||[];
  if(providers.length!==1){gap(providers.length?'provider_id_ambiguous':'provider_ingredient_missing');continue;}
  const provider=providers[0];
  // Upstream RxNorm canonical identity must independently retain the same exact
  // ingredient name. E.g. methionine != N-acetylmethionine; never strip a salt.
  if(!/^\d+$/.test(provider.rxcui||'')||identityName(provider.rxnorm_name)!==nameEn){gap('provider_canonical_identity_disagrees');continue;}
  links.push({substanceId:substance.id,nameRu:substance.nameRu,nameEn,termCodes:found.map(t=>t.code).sort(),providerId:provider.id,providerName:provider.name,rxcui:provider.rxcui,rxnormName:provider.rxnorm_name,relation:'exact'});
 }
 return {links,gaps};
}
