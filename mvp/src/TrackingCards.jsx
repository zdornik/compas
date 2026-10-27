import {MOODS,dateLabel} from './domain.js';
import './tracking.css';
export function MetricBar({label,value,max,text,detail,tone='sage'}){
 const present=typeof value==='number'&&Number.isFinite(value),percent=present?Math.max(0,Math.min(100,value/max*100)):0;
 return <article className={'trk-metric tone-'+tone}><span>{label}</span><strong>{present?text:'—'}</strong><div className="trk-bar" role={present?'meter':undefined} aria-label={label} aria-valuemin={present?0:undefined} aria-valuemax={present?max:undefined} aria-valuenow={present?value:undefined} aria-valuetext={present?text:undefined}><i style={{width:percent+'%'}}/></div><small>{detail||(present?'По сохранённым отметкам':'Пока нет данных')}</small></article>;
}
export function CompletionRing({value,label='Отмечено принято'}){
 return <div className="trk-ring" role="img" aria-label={value===null?'Нет запланированных приёмов':label+': '+value+'%'}><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42"/><circle cx="50" cy="50" r="42" pathLength="100" opacity={value>0?1:0} strokeDasharray={`${value??0} 100`}/></svg><strong>{value===null?'—':value+'%'}</strong></div>;
}
export function TrackingCards({tracking}){
 const t=tracking||{},m=t.mood,s=t.sleep,date=day=>day?dateLabel(day+'T12:00:00Z'):'';
 return <div className="trk-metrics" aria-label="Показатели пациента">
  <MetricBar label="Настроение за день" value={m?.value} max={6} text={m?.label} tone={m?MOODS[Math.round(m.value)].tone:'sage'} detail={m?date(m.day)+(m.source==='moments'?' · среднее отметок':' · итог дня'):'Нет отметок за 14 дней'}/>
  <MetricBar label="Сон" value={s?.minutes} max={720} text={s?`${Math.floor(s.minutes/60)} ч ${s.minutes%60} мин`:''} detail={s?date(s.day)+' · '+s.quality:'Нет записей за 14 дней'}/>
  <MetricBar label="Отметки приёма" value={t.medication?.percent} max={100} text={t.medication?.percent+'%'} detail={t.medication?.due?`${t.medication.taken} из ${t.medication.due} назначенных приёмов · 14 дней`:'Нет расписания назначений врача'}/>
  {['phq9','gad7'].map(id=>{const scale=t.scales?.[id];return <MetricBar key={id} label={id==='phq9'?'PHQ-9 · депрессивные симптомы':'GAD-7 · тревожные симптомы'} value={scale?.score} max={id==='phq9'?27:21} text={scale?`${scale.score} / ${scale.max}`:''} tone="blue" detail={scale?date(scale.day)+' · скрининг':'Нет результата среди последних 20 опросников'}/>;})}
 </div>;
}
