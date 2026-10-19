// Bounded public-reference benchmark. Never requests accounts, diaries or therapy.
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin=process.env.COMPASS_TEST_ORIGIN||'http://127.0.0.1:4174';
const label=process.argv.find(v=>v.startsWith('--label='))?.split('=')[1]||'current';
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid benchmark label');
const samples=5;
const get=async path=>{if(!path.startsWith('/api/knowledge/'))throw new Error('Public reference only');const start=performance.now(),response=await fetch(origin+path,{signal:AbortSignal.timeout(30000)});if(response.status!==200)throw new Error(`${response.status} ${path}`);const data=await response.json();return {data,ms:performance.now()-start};};
const product=async name=>(await get('/api/knowledge/products?allStatuses=1&limit=100&q='+encodeURIComponent(name))).data.items.find(row=>row.inn===name);
const levome=await product('Левомепромазин'),caffeine=await product('Кофеин'),theophylline=await product('Теофиллин');
const detail=(await get('/api/knowledge/products/'+levome.id)).data;const klp=detail.esklp.records[0].klpCode;
const cases=[['status','/api/knowledge/status'],['products-ru','/api/knowledge/products?scope=psychiatry&q='+encodeURIComponent('левомепромазин')],['products-en','/api/knowledge/products?scope=psychiatry&q=fluvoxamine'],['suggestions-latin','/api/knowledge/suggestions?q=Paroxetinum'],['suggestions-brand','/api/knowledge/suggestions?q='+encodeURIComponent('Тизерцин')],['code-klp','/api/knowledge/products?allStatuses=1&limit=100&q='+encodeURIComponent(klp)],['product-card','/api/knowledge/products/'+levome.id],['interactions','/api/knowledge/interactions?id='+caffeine.id+'&id='+theophylline.id]];
const results=[];for(const [name,path] of cases){const times=[],hashes=new Set();let data;for(let n=0;n<samples+1;n++){const r=await get(path);data=r.data;hashes.add(createHash('sha256').update(JSON.stringify(data)).digest('hex'));if(n)times.push(r.ms);}if(hashes.size!==1)throw new Error('Unstable reference response: '+name);const sorted=[...times].sort((a,b)=>a-b);results.push({name,path,medianMs:Math.round(sorted[Math.floor(sorted.length/2)]*10)/10,maxMs:Math.round(sorted.at(-1)*10)/10,samples,responseHash:[...hashes][0],response:data});console.log(JSON.stringify({name,medianMs:results.at(-1).medianMs,maxMs:results.at(-1).maxMs}));}
await mkdir('qa',{recursive:true});await writeFile(`qa/reference-benchmark-${label}.json`,JSON.stringify({origin,label,measuredAt:new Date().toISOString(),warmupPerCase:1,samples,results},null,2)+'\n');
