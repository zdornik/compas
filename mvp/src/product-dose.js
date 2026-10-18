// Read a registered solid-form strength, never a therapeutic recommendation.
export function smallestProductStrength(product) {
 const descriptions=String(product?.form||'').split(';').filter(text=>text.trim()).map(text=>text.split(/\s*[-–—]\s*(?=упаков|бан|блистер|флакон)/i)[0]);
 const doses=[];
 for(const text of descriptions){
  const form=/^\s*таблетк/i.test(text)?'tablet':/^\s*капсул/i.test(text)?'capsule':null;
  if(!form||/[+%/]|(?:мг|мкг|г)\s*на\s/i.test(text))return null;
  // Packaging quantities (шт.) and excipient information are not strengths.
  const matches=[...text.matchAll(/(?<![\d.,])([\d]+(?:[.,]\d+)?)\s*(мкг|мг|г)(?![а-я])/gi)];
  if(matches.length!==1)return null;
  const value=Number(matches[0][1].replace(',','.')),unit=matches[0][2].toLowerCase();
  if(!(value>0))return null;
  doses.push({form,strength:unit==='г'?value*1000:value,unit:unit==='г'?'мг':unit,quantity:1});
 }
 if(!doses.length||new Set(doses.map(row=>row.form)).size!==1)return null;
 return doses.sort((a,b)=>a.strength*(a.unit==='мкг'?.001:1)-b.strength*(b.unit==='мкг'?.001:1))[0];
}

export function applyProductSelection(draft,patch) {
 const dose=patch.productId&&patch.productId!==draft.productId?smallestProductStrength(patch.product):null;
 // Existing titration has its own per-stage strengths and must stay intact.
 return {...draft,...patch,...(dose&&!draft.titration?.enabled?dose:{}),doseAutofill:dose&&!draft.titration?.enabled?`${dose.strength} ${dose.unit}`:null};
}
