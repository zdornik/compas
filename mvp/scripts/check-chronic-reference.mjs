// Public data only; never creates a patient or prescription.
import assert from 'node:assert/strict';
const origin=process.env.COMPASS_TEST_ORIGIN||'http://127.0.0.1:4174';
const get=async path=>{const r=await fetch(origin+'/api/knowledge/'+path,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,path);return r.json();};
const rows=[];
for(const name of ['Аллопуринол','Аторвастатин','Розувастатин','Симвастатин','Питавастатин','Метформин','Лозартан']){
 const result=await get('products?q='+encodeURIComponent(name)+'&limit=100');const product=result.items.find(p=>p.inn===name);assert.ok(product,name+' must be available outside psychiatry');
 const detail=await get('products/'+product.id);assert.equal(detail.identityMappings[0].status,'mapped',name+' identity');
 const suggestions=await get('suggestions?q='+encodeURIComponent(name));assert.equal(suggestions.substances[0]?.name,name,'Exact INN must rank first: '+name);
 rows.push({name,products:result.total,english:detail.identityMappings[0].nameEn,instructions:detail.instructions.length,id:product.id});
}
for(const row of rows.slice(0,5))assert.ok(row.instructions>0,row.name+' priority instruction imported');
const statins=await get('products?q='+encodeURIComponent('статины')+'&limit=100');assert.ok(statins.total>50);assert.ok(statins.items.every(p=>!/нистатин|соматостатин/i.test(p.inn)));
const statinSuggestions=await get('suggestions?q='+encodeURIComponent('статины'));assert.ok(statinSuggestions.substances.length);assert.ok(statinSuggestions.substances.every(s=>/статин/i.test(s.name)));
const ipp=await get('suggestions?q='+encodeURIComponent('ИПП'));assert.ok(ipp.substances.length);assert.ok(ipp.substances.every(s=>!/магния|алюминия|кальция/i.test(s.name)));
const brand=await get('suggestions?q='+encodeURIComponent('Крестор'));assert.ok(brand.products.some(p=>p.inn==='Розувастатин'));
const pair=await get('interactions?id='+rows[0].id+'&id='+rows[1].id);assert.equal(pair.safeToCombine,null);assert.equal(pair.identityMappings.filter(x=>x.status==='mapped').length,2);
console.log(JSON.stringify({checked:rows.map(({id,...row})=>row),statinRecords:statins.total,groupAliasesVerified:true,priorityInstructionsImported:true,sourceIdentitiesRetained:true,safeToCombine:null,patientDataRead:false,patientDataWritten:false}));
