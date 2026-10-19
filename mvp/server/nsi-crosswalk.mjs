import {buildInnCrosswalk,identityName} from './ingredient-crosswalk.mjs';
// Only full primary names of chemical ingredients. Source alternatives stay
// searchable naming evidence, never automatic salt/composition/clinical links.
export function buildNsiCrosswalk(substances,terms,drugs,existing=[],eaeu=[]){
 const official=new Map();for(const term of eaeu){const key=identityName(term.name_ru);if(!official.has(key))official.set(key,new Set());if(term.name_en)official.get(key).add(identityName(term.name_en));}
 const eligible=terms.filter(term=>['1','2'].includes(term.group)).map(term=>({...term,name_en:term.name_en||''}));
 const result=buildInnCrosswalk(substances,eligible,drugs,existing),links=[],conflicts=[];
 for(const row of result.links){const english=official.get(identityName(row.nameRu));if(english?.size&&(english.size!==1||!english.has(row.nameEn)))conflicts.push({...row,reason:'official_naming_sources_disagree'});else links.push({...row,nsiCodes:row.termCodes});}
 return {links,gaps:[...result.gaps,...conflicts]};
}
