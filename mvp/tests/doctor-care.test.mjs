import test from 'node:test';
import assert from 'node:assert/strict';
import {demoDiary,diaryPeriod,sleepSummary,DOCTOR_DEMO_DAY} from '../src/doctor-care.js';
test('physician demo diary keeps patient fixtures separate and leaves missing days empty',()=>{
 const first=demoDiary('maria'),second=demoDiary('alex');
 assert.deepEqual(first,demoDiary('maria'));assert.deepEqual(demoDiary('dmitry'),[]);
 assert.ok(first.every(row=>!second.some(other=>other.id===row.id)));
 assert.ok(first.every(row=>row.day<=DOCTOR_DEMO_DAY));
 const week=diaryPeriod(first,7);assert.ok(week.every(row=>row.day>='2026-10-12'));
 assert.ok(week.filter(row=>row.type==='mood').length<7);
 assert.equal(sleepSummary([{type:'sleep',hours:6,minutes:30},{type:'sleep',hours:8,minutes:0},{type:'mood',value:2}]).mean,435);
 assert.deepEqual(sleepSummary([]),{count:0,mean:null});
});
