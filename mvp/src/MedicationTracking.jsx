import {useEffect,useMemo,useState} from 'react';
import {useEntryHistory,HistoryStatus} from './useEntryHistory.jsx';
import {mergeEntries} from './history-data.js';
import {dayKey,dateLabel} from './domain.js';
import {addDays} from './medications.js';
import {medicationTracking} from './tracking.js';
import {CompletionRing} from './TrackingCards.jsx';
import {SlidingTabs} from './SlidingTabs.jsx';
import './tracking.css';
export function MedicationTracking({entries:localEntries,active=true,linkId,owner,enabled,doctorOnly=false,showStreak=false,onSelect}){
 const [clock,setClock]=useState(()=>new Date());
 useEffect(()=>{if(!active)return;setClock(new Date());const timer=setInterval(()=>setClock(new Date()),30000);return()=>clearInterval(timer);},[active]);
 const today=dayKey(),[period,setPeriod]=useState(14),from=addDays(today,-61);
 const history=useEntryHistory({kind:'doses',from,to:today,active,linkId,owner,enabled});
 const entries=useMemo(()=>mergeEntries(history.entries,localEntries),[history.entries,localEntries]);
 const all=useMemo(()=>medicationTracking(entries,{from,to:today,doctorOnly,now:clock}),[entries,from,today,doctorOnly,clock]);
 const rows=all.days.slice(-period),due=rows.reduce((sum,row)=>sum+row.due,0),taken=rows.reduce((sum,row)=>sum+row.taken,0),percent=due?Math.round(taken/due*100):null;
 return <section className="trk-adherence" aria-label="Трекинг приёма препаратов"><header><div><h2>{doctorOnly?'Выполнение назначений':'Мои отметки приёма'}</h2><p>{doctorOnly?'По назначениям врачей':'По сохранённому расписанию'} · {period} дней</p></div><SlidingTabs items={[{id:7,label:'7 дней'},{id:14,label:'14 дней'},{id:30,label:'Месяц'}]} value={period} onChange={setPeriod} label="Период приёма препаратов"/></header>
  <HistoryStatus resource={history}/>{!history.loading&&!history.error&&<><div className="trk-adherence-summary"><CompletionRing value={percent}/><div><strong>{due?`${taken} из ${due} приёмов отмечено принято`:'Нет запланированных приёмов за период'}</strong><p>{rows.reduce((sum,row)=>sum+row.skipped,0)} отмечено пропущено · {rows.reduce((sum,row)=>sum+row.unmarked,0)} без отметки</p>{showStreak&&<div className="trk-streak"><b>{all.streak}{all.streakAtLeast?'+':''}</b><span>дней подряд со всеми отметками «Принят»</span></div>}</div></div>
  <div className="trk-dose-days" role="group" aria-label="Отметки приёма по дням">{rows.map(row=><button key={row.day} type="button" onClick={()=>onSelect?.(row.day)} disabled={!onSelect} aria-label={`${dateLabel(row.day+'T12:00:00Z')}: ${row.taken} из ${row.due} отмечено принято`}><span className="trk-dose-column"><i style={{height:(row.percent??0)+'%'}}/>{!row.due&&<em>—</em>}</span><small>{Number(row.day.slice(-2))}</small></button>)}</div>
  <p className="trk-help">Это отметки пациента, а не подтверждение фактического приёма. Будущее время не входит в процент; отсутствие отметки не означает пропуск. Сопоставляйте с динамикой состояния, не делая вывода о причине изменений.</p></>}
 </section>;
}
