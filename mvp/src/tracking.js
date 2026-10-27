import {dayKey,MOODS} from './domain.js';
import {addDays,isCalendarDate,medicationSchedule} from './medications.js';

const newest=(a,b)=>(b.updatedAt||b.at||'').localeCompare(a.updatedAt||a.at||'')||b.id.localeCompare(a.id);
export function dailyMoodSeries(entries,from,to){
  if(!isCalendarDate(from)||!isCalendarDate(to)||to<from||(Date.parse(to)-Date.parse(from))/86400000>61)throw Error('Выберите период до 62 дней');
  const rows=entries.filter(row=>row.type==='mood'&&row.day>=from&&row.day<=to&&Number.isInteger(row.value)&&row.value>=0&&row.value<MOODS.length);
  const result=[];
  for(let day=from;day<=to;day=addDays(day,1)){
    const observations=rows.filter(row=>row.day===day).sort(newest),daily=observations.find(row=>row.kind==='day');
    const value=daily?daily.value:observations.length?observations.reduce((sum,row)=>sum+row.value,0)/observations.length:null;
    result.push({day,value,label:value===null?'Нет отметок':MOODS[Math.round(value)].name,source:daily?'daily':observations.length?'moments':null,count:observations.length,entries:observations});
  }
  return result;
}

// This describes saved self-reports, not verified ingestion or a clinical adherence score.
export function medicationTracking(entries,{from,to=dayKey(),now=new Date(),doctorOnly=false,doctorId=null}={}){
  from??=addDays(to,-13);
  dailyMoodSeries([],from,to);
  const today=dayKey(now),time=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  const planIds=new Set(entries.filter(row=>row.type==='medication-plan'&&(!doctorOnly||(doctorId && row.origin==='doctor' && row.prescriberId===doctorId))).map(row=>row.id));
  const relevant=entries.filter(row=>row.type==='medication-plan'?planIds.has(row.id):row.type==='medication-dose'&&planIds.has(row.planId));
  const days=[];
  for(let day=from;day<=to;day=addDays(day,1)){
    const all=medicationSchedule(relevant,day),due=all.filter(row=>day<today||(day===today&&(row.time<=time||row.status!=='planned')));
    const taken=due.filter(row=>row.status==='taken').length,skipped=due.filter(row=>row.status==='skipped').length;
    days.push({day,scheduled:all.length,due:due.length,taken,skipped,unmarked:due.length-taken-skipped,percent:due.length?Math.round(taken/due.length*100):null,complete:all.length>0&&all.every(row=>row.status==='taken')&&day<=today});
  }
  const due=days.reduce((n,row)=>n+row.due,0),taken=days.reduce((n,row)=>n+row.taken,0),skipped=days.reduce((n,row)=>n+row.skipped,0);
  let end=days.find(row=>row.day===today)?.complete?today:addDays(today,-1),streak=0;
  if(to<end)end=to;
  for(let day=end;day>=from;day=addDays(day,-1)){if(!days.find(row=>row.day===day)?.complete)break;streak++;}
  const earliest=entries.filter(row=>row.type==='medication-plan'&&planIds.has(row.id)).map(row=>row.startDate).sort()[0];
  return {days,due,taken,skipped,unmarked:due-taken-skipped,percent:due?Math.round(taken/due*100):null,streak,streakAtLeast:streak>0&&addDays(end,1-streak)===from&&earliest<from};
}

export function trackingSnapshot(entries,end=dayKey(),doctorId=null){
  const from=addDays(end,-13),moods=dailyMoodSeries(entries,from,end),latest=moods.filter(row=>row.value!==null).at(-1);
  const sleep=entries.filter(row=>row.type==='sleep'&&row.day>=from&&row.day<=end).sort((a,b)=>b.day.localeCompare(a.day)||newest(a,b))[0];
  const scales=Object.fromEntries(['phq9','gad7'].map(id=>{const row=entries.filter(row=>row.type==='assessment'&&row.scaleId===id).sort(newest)[0];return [id,row?{score:row.score,max:row.max,day:row.day,severity:row.severity}:null];}));
  const medication=medicationTracking(entries,{from,to:end,doctorOnly:true,doctorId});
  return {from,to:end,mood:latest?{day:latest.day,value:latest.value,label:latest.label,source:latest.source}:null,moodDays:moods.filter(row=>row.value!==null).length,sleep:sleep?{day:sleep.day,minutes:Number(sleep.hours)*60+Number(sleep.minutes),quality:sleep.quality}:null,scales,medication:{percent:medication.percent,due:medication.due,taken:medication.taken,skipped:medication.skipped,unmarked:medication.unmarked}};
}
