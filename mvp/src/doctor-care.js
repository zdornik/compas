// Synthetic physician workspace only. No patient cookie, browser storage or prescribing API.
import { SCALES,scoreAssessment } from './assessments.js';
import { MOODS } from './domain.js';
import { addDays } from './medications.js';
export const DOCTOR_DEMO_DAY='2026-10-18';
export function demoDiary(patientId) {
 if(patientId==='dmitry')return [];
 const seed=[...patientId].reduce((sum,char)=>sum+char.charCodeAt(0),0),entries=[];
 for(let i=0;i<30;i++){
  const day=addDays(DOCTOR_DEMO_DAY,-i),value=[2,3,4,3,2,3,4,5,3,2,3][(i+seed)%11];
  if((i+seed)%7!==0)entries.push({id:`${patientId}-mood-${day}`,type:'mood',day,at:`${day}T20:10:00+03:00`,value,words:[MOODS[value].words[(i+seed)%3]],factors:[['Работа','Отдых','Общение'][(i+seed)%3]],note:['После прогулки стало немного спокойнее.','Сегодня получилось сделать перерыв и отдохнуть.','День прошёл в обычном ритме.'][i%3],sample:true});
  if((i+seed)%6!==0){const duration=350+(i*23+seed)%145;entries.push({id:`${patientId}-sleep-${day}`,type:'sleep',day,at:`${day}T08:30:00+03:00`,hours:Math.floor(duration/60),minutes:duration%60,quality:['Хорошо','Нормально','Не очень'][(i+seed)%3],note:'',sample:true});}
 }
 for(const [index,scaleId] of ['phq9','gad7'].entries()){
  const answers=scaleId==='phq9'?[1,1,1,1,1,1,1,1,0]:[1,1,1,1,1,1,0],day=addDays(DOCTOR_DEMO_DAY,-2);
  entries.push({id:`${patientId}-${scaleId}`,type:'assessment',scaleId,version:SCALES[scaleId].version,answers,impact:1,...scoreAssessment(scaleId,answers),day,at:`${day}T18:${index?'15':'00'}:00+03:00`,sample:true});
 }
 for(let index=0;index<3;index++){
  const day=addDays(DOCTOR_DEMO_DAY,-index);
  entries.push({id:`${patientId}-journal-${day}`,type:'journal',day,at:`${day}T20:30:00+03:00`,title:['Немного времени для себя','После прогулки','Мысли перед приёмом'][index],body:['Сегодня получилось замедлиться и оставить время для отдыха.\n\nХочется чаще делать такие паузы и замечать, что помогает восстановиться.','После прогулки стало спокойнее. Вечером было время поговорить с близкими.','Хочу обсудить на приёме, как прошла неделя и что изменилось в самочувствии.'][index],sharedWithDoctor:true,sample:true});
 }
 return entries.sort((a,b)=>b.at.localeCompare(a.at));
}
export function diaryPeriod(entries,days,end=DOCTOR_DEMO_DAY){const start=addDays(end,1-days);return entries.filter(entry=>entry.day>=start&&entry.day<=end);}
export function sleepMinutes(entry){return Number(entry.hours)*60+Number(entry.minutes);}
export function sleepSummary(entries){const rows=entries.filter(entry=>entry.type==='sleep');return {count:rows.length,mean:rows.length?Math.round(rows.reduce((sum,row)=>sum+sleepMinutes(row),0)/rows.length):null};}
export function durationLabel(minutes){return `${Math.floor(minutes/60)} ч${minutes%60?' '+minutes%60+' мин':''}`;}
