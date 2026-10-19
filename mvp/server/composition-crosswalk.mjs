import {identityName} from './ingredient-crosswalk.mjs';
// Literal source components only. Never split slashes, alternatives, botanical
// brackets or salt/form qualifiers, and never infer a missing ingredient.
export function compositionNames(name){
 if(!name?.includes('+')||/[\/;\[\](){}]/u.test(name))return null;
 const parts=name.split('+').map(x=>x.trim());
 return parts.length>=2&&parts.length<=30&&parts.every(Boolean)&&new Set(parts.map(identityName)).size===parts.length?parts:null;
}
export function findCompositionDeclaration(pages,name){
 const expected=compositionNames(name)?.map(identityName).sort();if(!expected)return null;
 const header=/^(?:действующие\s+вещества|(?:международное\s+непатентованное(?:\s+или\s+группировочное)?|группировочное)\s+наименование)\s*:?\s*(.*)$/iu;
 for(const page of pages.filter(p=>p.page<=2)){
  const lines=page.text.split(/\r?\n/u).map(x=>x.trim());
  for(let i=0;i<lines.length;i++){
   const hit=lines[i].match(header);if(!hit)continue;
   let text=hit[1];
   for(let extra=0;extra<5;extra++){
    const actual=compositionNames(text)?.map(identityName).sort();
    if(actual&&JSON.stringify(actual)===JSON.stringify(expected))return {page:page.page,text:lines[i]+(extra?'\n'+lines.slice(i+1,i+extra+1).join('\n'):'')};
    if(i+extra+1>=lines.length||text.length>600)break;
    text+=' '+lines[i+extra+1];
   }
  }
 }
 return null;
}
export function applyCompositionDependencies(mapping,dependencies,leafMappings){
 if(mapping.status!=='mapped'||(!dependencies?.length&&!mapping.requiresComponentDependencies))return mapping;
 dependencies=dependencies||[];
 const valid=dependencies.length===mapping.expectedComponents&&new Set(dependencies.map(d=>d.substanceId)).size===dependencies.length&&dependencies.every(d=>{
  const leaf=leafMappings.get(d.substanceId),part=leaf?.components[0];
  return leaf?.status==='mapped'&&leaf.expectedComponents===1&&leaf.components.length===1&&part.ingredientId===d.ingredientId&&part.providerId===d.providerId&&mapping.components.some(p=>p.ingredientId===d.ingredientId&&p.providerId===d.providerId&&p.relation===part.relation&&p.chemicalForm===part.chemicalForm);
 });
 return valid?mapping:{...mapping,status:'unmapped',reason:'component_source_changed'};
}
