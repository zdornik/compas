import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dailyMoodSeries,medicationTracking,trackingSnapshot} from '../src/tracking.js';
import {makeMedicationPlan,medicationDraft,makeMedicationDose,medicationDoseId} from '../src/medications.js';
const now=new Date('2026-10-27T09:00:00Z');
const mood=(id,day,value,kind='moment')=>({id,type:'mood',day,value,kind,at:day+'T18:00:00Z',words:['Спокойствие'],factors:['Отдых']});
test('daily mood prioritises an explicit day report and otherwise averages actual moments',()=>{
 const rows=[mood('a','2026-10-25',1),mood('b','2026-10-25',5),mood('c','2026-10-26',1),mood('d','2026-10-26',5),mood('e','2026-10-26',4,'day')];
 const series=dailyMoodSeries(rows,'2026-10-25','2026-10-27');
 assert.equal(series[0].value,3);assert.equal(series[0].source,'moments');
 assert.equal(series[1].value,4);assert.equal(series[1].source,'daily');assert.equal(series[1].entries.length,3);
 assert.equal(series[2].value,null);assert.equal(series[2].source,null);
});
test('missing mood days stay empty and invalid periods cannot create an unbounded history',()=>{
 assert.equal(dailyMoodSeries([],'2026-10-25','2026-10-27').every(row=>row.value===null),true);
 assert.throws(()=>dailyMoodSeries([],'2026-01-01','2026-10-27'));
 assert.throws(()=>dailyMoodSeries([],'2026-02-30','2026-03-01'));
});
const plan=(patch={})=>makeMedicationPlan({...medicationDraft(),name:'Синтетический препарат',strength:1,quantity:1,startDate:'2026-10-25',times:['09:00','18:00'],...patch},randomUUID(),null,new Date('2026-10-25T05:00:00Z'));
const mark=(p,day,time,status='taken')=>makeMedicationDose({planId:p.id,day,time,status,expectedRevision:0},medicationDoseId(p.id,day,time),null,p,now);
test('intake tracking separates skipped and unmarked and excludes future planned doses',()=>{
 const p=plan(),rows=[p,mark(p,'2026-10-26','09:00'),mark(p,'2026-10-26','18:00','skipped'),mark(p,'2026-10-27','09:00')];
 const result=medicationTracking(rows,{from:'2026-10-26',to:'2026-10-27',now});
 assert.equal(result.due,3);assert.equal(result.taken,2);assert.equal(result.skipped,1);assert.equal(result.unmarked,0);assert.equal(result.percent,67);
 assert.equal(result.days[1].scheduled,2);assert.equal(result.days[1].due,1);assert.equal(result.days[1].complete,false);
 const unmarked=medicationTracking([p],{from:'2026-10-26',to:'2026-10-26',now});assert.equal(unmarked.unmarked,2);assert.equal(unmarked.skipped,0);
});
test('streak counts complete consecutive days and does not erase yesterday while today is in progress',()=>{
 const p=plan(),entries=[p,...['2026-10-25','2026-10-26'].flatMap(day=>p.times.map(time=>mark(p,day,time)))];
 assert.equal(medicationTracking(entries,{from:'2026-10-25',to:'2026-10-27',now}).streak,2);
 assert.equal(medicationTracking([p],{from:'2026-10-25',to:'2026-10-27',now}).streak,0);
});
test('physician completion excludes patient-created plans and missing prescriptions have no invented percent',()=>{
 const p=plan(),doctor={...plan(),origin:'doctor'};
 const result=medicationTracking([p,doctor,mark(p,'2026-10-26','09:00')],{from:'2026-10-26',to:'2026-10-26',now,doctorOnly:true});
 assert.equal(result.due,2);assert.equal(result.taken,0);
 assert.equal(medicationTracking([p],{from:'2026-10-26',to:'2026-10-26',now,doctorOnly:true}).percent,null);
});
test('a previous plan version and recorded snapshots survive edits and archiving in tracking',()=>{
 const p=plan(),event=mark(p,'2026-10-26','09:00');
 const edited=makeMedicationPlan({...p,times:['10:00'],expectedRevision:p.revision},p.id,p,new Date('2026-10-27T06:00:00Z'));
 const archived=makeMedicationPlan({...edited,archived:true,expectedRevision:edited.revision},p.id,edited,new Date('2026-10-27T07:00:00Z'));
 const history=medicationTracking([archived,event],{from:'2026-10-26',to:'2026-10-27',now});
 assert.equal(history.days[0].due,2);assert.equal(history.days[0].taken,1);assert.equal(history.days[1].scheduled,0);
});
test('tracking snapshots expose only compact metrics, not diary bodies, reasons or questionnaire answers',()=>{
 const snapshot=trackingSnapshot([mood('a','2026-10-26',4),{id:'x',type:'journal',body:'Private diary'},{id:'q',type:'assessment',scaleId:'phq9',day:'2026-10-26',at:'2026-10-26T12:00:00Z',score:3,max:27,severity:'Скрининг',answers:[0,1]}],'2026-10-27');
 assert.equal(snapshot.mood.value,4);assert.equal(snapshot.scales.phq9.score,3);
 assert.doesNotMatch(JSON.stringify(snapshot),/Private diary|Спокойствие|Отдых|answers/);
});
test('editing an older sleep observation does not replace the latest day in the overview',()=>{
 const result=trackingSnapshot([{id:'today',type:'sleep',day:'2026-10-27',updatedAt:'2026-10-27T06:00:00Z',hours:7,minutes:30,quality:'Хорошо'},{id:'yesterday',type:'sleep',day:'2026-10-26',updatedAt:'2026-10-27T07:00:00Z',hours:6,minutes:0,quality:'Нормально'}],'2026-10-27');
 assert.equal(result.sleep.day,'2026-10-27');assert.equal(result.sleep.minutes,450);
});
