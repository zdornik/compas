// Small, bounded, read-only smoke load against public reference endpoints.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const origin=process.env.COMPASS_TEST_ORIGIN||'http://127.0.0.1:4174';
const cases=JSON.parse(await readFile('qa/reference-benchmark-before.json')).results;
const requests=32,concurrency=8,times=[];let next=0;
const start=performance.now();
await Promise.all(Array.from({length:concurrency},async()=>{
 while(next<requests){
  const sample=cases[next++%cases.length],sent=performance.now();
  const r=await fetch(origin+sample.path,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,sample.name);
  assert.deepEqual(await r.json(),sample.response,sample.name+' concurrent response parity');times.push(performance.now()-sent);
 }
}));
const elapsedMs=performance.now()-start;times.sort((a,b)=>a-b);
const result={origin,requests,concurrency,elapsedMs:Math.round(elapsedMs),medianMs:Math.round(times[Math.floor(times.length/2)]*10)/10,p95Ms:Math.round(times[Math.ceil(times.length*.95)-1]*10)/10,maxMs:Math.round(times.at(-1)*10)/10,errors:0,responsesEqual:true,patientDataRead:false};
await writeFile('qa/reference-concurrency.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
