import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {historyOptions,historyCursor,readHistoryCursor,entryHistory} from '../server/history.mjs';
import {readHistoryWindow,mergeEntries} from '../src/history-data.js';
const options=value=>historyOptions(new URLSearchParams(value));
test('history bounds valid calendar periods, page sizes and encrypted search input',()=>{
  assert.equal(options({kind:'observations',from:'2026-01-01',to:'2026-03-03'}).limit,20);
  for(const query of [{from:'2026-01-01',to:'2026-03-04'},{from:'2026-02-30',to:'2026-03-01'},{kind:'notes',limit:101},{kind:'doses'},{kind:'notes',q:'x'.repeat(201)}])assert.throws(()=>options(query),{status:400});
});
test('history cursors preserve timestamp precision and bind owner, range and search',()=>{
  const key=randomBytes(32),query=options({kind:'notes',q:'слово'}),value={at:'2026-10-01 12:00:00.123456+00',id:'note',revision:'v1'};
  const before=historyCursor(key,'owner',query,value);
  assert.deepEqual(readHistoryCursor(key,'owner',{...query,before}),value);
  for(const [owner,params] of [['other',query],['owner',{...query,q:'another'}]])assert.throws(()=>readHistoryCursor(key,owner,{...params,before}),{status:400});
  assert.throws(()=>readHistoryCursor(key,'owner',{...query,before:before+'x'}),{status:400});
});
test('encrypted search advances over bounded misses, returns excerpts and never skips unscanned hits',async()=>{
  const query=options({kind:'notes',q:'hit',limit:1}),key=randomBytes(32);
  const db={query:async sql=>sql.includes('local_patients')?{rows:[{state_revision:'3'}]}:{rows:[0,1,2].map(i=>({id:'note'+i,cursor_at:`2026-10-01 12:00:00.00000${i}+00`,payload:{id:'note'+i,type:'journal',body:i?'hit'.repeat(200):'miss'}}))}};
  const page=await entryHistory(db,'patient',query,{key,decode:row=>row.payload});
  assert.equal(page.scanned,2);assert.equal(page.entries.length,1);assert.equal(page.entries[0].body,undefined);assert.equal(page.entries[0].excerpt.length,240);
  assert.equal(readHistoryCursor(key,'patient',{...query,before:page.nextCursor}).id,'note1');
  await assert.rejects(()=>entryHistory(db,'patient',{...query,before:historyCursor(key,'patient',query,{revision:'old',at:'2026-01-01',id:'x'})},{key,decode:row=>row.payload}),{status:409,code:'HISTORY_CHANGED'});
});
test('window reader restarts changed pagination and reuses unchanged windows without losing entries',async()=>{
  let calls=0;
  const load=async()=>{calls++;if(calls===1)return {entries:[{id:'stale'}],revision:'old',nextCursor:'next'};if(calls===2)throw Object.assign(Error('changed'),{code:'HISTORY_CHANGED'});return {entries:[{id:'fresh'}],revision:'new'};};
  const result=await readHistoryWindow(load);assert.deepEqual(result.entries,[{id:'fresh'}]);assert.equal(calls,3);
  assert.equal(await readHistoryWindow(async()=>({unchanged:true}),null,result),result);
  assert.deepEqual(mergeEntries([{id:'x',revision:2}],[{id:'x',revision:1}]),[{id:'x',revision:2}]);
});
