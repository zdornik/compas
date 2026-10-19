// Replay public search edges against the previous API, then the optimized API.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const origin=process.env.COMPASS_TEST_ORIGIN||'http://127.0.0.1:4174',file='qa/reference-parity.json';
const get=async path=>{const r=await fetch(origin+path,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,path);return r.json();};
if(process.argv.includes('--capture')){
 const fixture=JSON.parse(await readFile('qa/reference-benchmark-before.json'));
 const klp=fixture.results.find(row=>row.name==='code-klp').path.split('q=')[1];
 const inn=fixture.results.find(row=>row.name==='products-ru').response.items[0].substanceId;
 const paths=['/api/knowledge/products','/api/knowledge/products?scope=psychiatry','/api/knowledge/products?allStatuses=1','/api/knowledge/products?scope=psychiatry&allStatuses=1','/api/knowledge/products?scope=psychiatry&offset=20&limit=5','/api/knowledge/products?offset=1000000','/api/knowledge/substance-products?id='+inn,'/api/knowledge/suggestions?q='+klp];
 for(const q of ['Се','%_','unlikely-reference-probe-xyz','Пароксетин','Potassium iodide'])for(const route of ['products','suggestions'])paths.push('/api/knowledge/'+route+'?q='+encodeURIComponent(q));
 const rows=[];for(const path of paths)rows.push({path,response:await get(path)});
 await writeFile(file,JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify({captured:rows.length,patientDataRead:false}));
}else{
 const rows=JSON.parse(await readFile(file));for(const row of rows)assert.deepEqual(await get(row.path),row.response,row.path);
 console.log(JSON.stringify({identicalEdgeResponses:rows.length,patientDataRead:false}));
}
