import assert from 'node:assert/strict';
const base=process.env.COMPASS_TEST_ORIGIN||'http://127.0.0.1:4174';
const get=async path=>{const response=await fetch(base+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,path);return response.json();};
const product=async name=>{const data=await get('/api/knowledge/products?scope=psychiatry&allStatuses=1&limit=100&q='+encodeURIComponent(name));const row=data.items.find(item=>item.inn===name);assert.ok(row,name);return row;};
const expected=[['Левомепромазин',['DDInter1175']],['Лития карбонат',['DDInter1081']],['Донепезил+Мемантин',['DDInter583','DDInter1146']],['Дифенгидрамин+Мелатонин',['DDInter569','DDInter1142']]];
const products=[];
for(const [name,ids] of expected){const row=await product(name);products.push(row);const mapping=(await get('/api/knowledge/products/'+row.id)).identityMappings[0];assert.equal(mapping.status,'mapped');assert.equal(mapping.manualProviderStatus,'linked');assert.ok(mapping.reviewSources.length);assert.deepEqual(mapping.components.map(part=>part.providerId).sort(),ids.sort());}
const galantamine=await product('Галантамин'),blocked=(await get('/api/knowledge/products/'+galantamine.id)).identityMappings[0];assert.equal(blocked.status,'unmapped');assert.equal(blocked.reason,'source_conflict');assert.ok(blocked.reviewNote.includes('benzgalantamine'));
const phenibut=await product('Аминофенилмасляная кислота'),absent=(await get('/api/knowledge/products/'+phenibut.id)).identityMappings[0];assert.equal(absent.status,'unmapped');assert.ok(absent.nameEn.includes('phenibut'));assert.equal(absent.manualProviderStatus,'absent_from_snapshot');
const pair=await get('/api/knowledge/interactions?id='+products[0].id+'&id='+products[1].id);assert.equal(pair.safeToCombine,null);assert.ok(pair.items.length);assert.equal(pair.identityMappings.filter(item=>item.status==='mapped').length,2);
const status=await get('/api/knowledge/status');assert.ok(status.counts.mappedSubstances>=861);
console.log(JSON.stringify({mappedRegistryNames:status.counts.mappedSubstances,manualCompositionsVerified:expected.length,methotrimeprazineSynonymVerified:true,twoCompleteCombinationsVerified:true,sourceConflictBlocked:true,absentProviderNotInvented:true,sourcePairFound:true,safeToCombine:pair.safeToCombine,patientDataRead:false,patientDataWritten:false}));
