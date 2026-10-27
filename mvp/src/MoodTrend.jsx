import {useMemo} from 'react';
import {dailyMoodSeries} from './tracking.js';
import {dateLabel,MOODS} from './domain.js';
import './tracking.css';
const date=day=>dateLabel(day+'T12:00:00Z');
export function MoodTrend({entries,from,to,selected,onSelect}){
 const days=useMemo(()=>from<=to?dailyMoodSeries(entries,from,to):[],[entries,from,to]),width=Math.max(330,days.length*28),height=180;
 const points=days.map((row,index)=>({...row,x:(index+.5)/Math.max(1,days.length)*width,y:row.value===null?null:height-14-row.value/6*(height-28)}));
 const chosen=days.find(row=>row.day===selected);
 return <section className="trk-mood-card dc-chart-card" aria-label="Динамика настроения"><header><h3>Настроение по дням</h3><span>Самооценка · 0–6</span></header>
  <div className="trk-mood-scroll"><div className="trk-mood-canvas" style={{width,minWidth:'100%',height}}><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">{[14,height/2,height-14].map(y=><line key={y} x1="0" x2={width} y1={y} y2={y} className="trk-grid"/>)}{points.slice(1).map((point,index)=>point.value!==null&&points[index].value!==null?<line key={point.day} x1={points[index].x} y1={points[index].y} x2={point.x} y2={point.y} className="trk-trend-line"/>:null)}</svg>{points.map(point=><button key={point.day} type="button" className={'trk-mood-dot '+(point.value===null?'is-empty':'tone-'+MOODS[Math.round(point.value)].tone)+(selected===point.day?' is-selected':'')} style={{left:(point.x/width*100)+'%',top:point.y??height/2}} aria-label={date(point.day)+': '+point.label} aria-pressed={selected===point.day} onClick={()=>onSelect(point.day)}><i/></button>)}</div></div>
  <div className="trk-chart-labels"><span>{days.length?date(days[0].day):'Нет данных'}</span><span>{days.length?date(days.at(-1).day):''}</span></div>
  <p className="trk-help">Точка — итог дня, линия — динамика соседних дней. Пустой круг — нет записи. Если итога нет, показано среднее отметок в моменте.</p>
  {chosen?.value!==null&&chosen&&<div className="trk-mood-detail" aria-live="polite"><strong>{date(chosen.day)} · {chosen.label}</strong>{chosen.entries.map(entry=><div key={entry.id}>{entry.words?.length>0&&<p>{entry.words.join(' · ')}</p>}{entry.factors?.length>0&&<small>Повлияло: {entry.factors.join(', ')}</small>}</div>)}<small>Подробные отметки выбранного дня — ниже.</small></div>}
 </section>;
}
