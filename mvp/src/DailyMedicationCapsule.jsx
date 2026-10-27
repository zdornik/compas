import { useId, useRef, useState } from 'react';
import { Check, Minus } from '@phosphor-icons/react';
import { dailyMedicationProgress } from './daily-medication-progress.js';
import { medicationSchedule, doseLabel, mealLabel } from './medications.js';
import { dayKey } from './domain.js';
import './daily-medication-capsule.css';

function CapsuleArt({ fraction }) {
  const id=useId().replaceAll(':','');
  return <svg className="daily-pill-art" viewBox="0 0 220 150" aria-hidden="true">
    <defs><clipPath id={id+'shell'}><rect x="24" y="43" width="172" height="64" rx="32"/></clipPath></defs>
    <g transform="rotate(-30 110 75)">
      <rect x="24" y="43" width="172" height="64" rx="32" fill="var(--ui-paper)"/>
      <g clipPath={`url(#${id}shell)`}><rect className="daily-pill-fill" x="24" y="43" width={172*fraction} height="64" fill="var(--accent)" fillOpacity=".68"/>
        <path d="M110 43H164A32 32 0 0 1 164 107H110Z" fill="var(--ui-soft)" fillOpacity=".4"/>
      </g>
      <rect x="24" y="43" width="172" height="64" rx="32" fill="none" stroke="var(--ui-ink)" strokeWidth="1.7"/>
      <path d="M110 44C101 60 101 90 110 106" fill="none" stroke="var(--ui-ink)" strokeWidth="1.3"/>
      <path d="M121 51H162C175 51 184 60 187 69" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="3" strokeLinecap="round"/>
    </g>
  </svg>;
}

export function DailyMedicationCapsule({ entries, now, onOpen, ready, onSave, onReload, onToast }) {
  const { total, taken, skipped, complete, fraction } = dailyMedicationProgress(entries, now);
  const rows=medicationSchedule(entries,dayKey(now));
  const [pending,setPending]=useState([]),[editing,setEditing]=useState(null);
  const inFlight=useRef(new Set());
  const mark=async(row,status)=>{
    if(inFlight.current.has(row.id)||!ready)return;
    inFlight.current.add(row.id);setPending(old=>[...old,row.id]);
    try{await onSave({id:row.id,type:'medication-dose',planId:row.planId,day:row.day,time:row.time,status,expectedRevision:row.eventRevision});setEditing(null);}
    catch(error){onToast?.(error.message);if(error.status===409)await onReload?.().catch(()=>{});}
    finally{inFlight.current.delete(row.id);setPending(old=>old.filter(id=>id!==row.id));}
  };
  return <section className={`daily-dose-card${complete?' is-complete':''}`} aria-label="Приёмы препаратов сегодня">
    <div className="daily-dose-copy"><span className="daily-dose-eyebrow">Ваша терапия сегодня</span>
      <h3>{!ready?'Загружаем отметки…':complete?'Отлично, на сегодня всё отмечено!':total?`Принято ${taken} из ${total}`:'На сегодня приёмов нет'}</h3>
      <p>{!ready?'Прогресс появится после подключения.':complete?'Все приёмы по расписанию отмечены. Спасибо, что заботитесь о себе.':skipped?`Пропущено: ${skipped}. Отметки можно изменить ниже.`:total?'Отмечайте приёмы здесь — капсула будет наполняться.':'Добавьте расписание из назначения в разделе «Терапия».'}</p>
      <button className="text-button" onClick={onOpen}>Открыть терапию →</button>
    </div>
    <div className="daily-dose-visual"><div className="daily-dose-capsule" role={ready&&total?'progressbar':'img'} aria-label="Отметки приёма на сегодня" aria-valuemin={ready&&total?0:undefined} aria-valuemax={ready&&total?total:undefined} aria-valuenow={ready&&total?taken:undefined} aria-valuetext={ready&&total?`${taken} из ${total} отмечено принято`:undefined}><CapsuleArt fraction={ready?fraction:0}/></div><small>{ready&&total?`${taken} / ${total}`:'—'}</small></div>
    {ready&&rows.length>0&&<div className="daily-dose-list">{rows.map(row=><article key={row.id} className="daily-dose-row"><time>{row.time}</time><button className="daily-dose-drug" onClick={onOpen}><strong>{row.name}</strong><span>{doseLabel(row)}{mealLabel(row.meal)?' · '+mealLabel(row.meal):''}</span></button>
      <div className="daily-dose-row-actions">{row.status==='planned'||editing===row.id?<><button className="daily-dose-take" disabled={!ready||pending.includes(row.id)} aria-label={`Отметить приём ${row.name} в ${row.time}`} onClick={()=>mark(row,'taken')}><Check size={15}/>{pending.includes(row.id)?'Сохраняем…':'Принят'}</button><button className="daily-dose-skip" disabled={!ready||pending.includes(row.id)} aria-label={`Отметить пропуск ${row.name} в ${row.time}`} onClick={()=>mark(row,'skipped')}><Minus size={15}/>Пропущен</button>{editing===row.id&&<button className="text-button" onClick={()=>setEditing(null)}>Отмена</button>}</>:<><span className={`daily-dose-status ${row.status}`}><Check size={15}/>{row.status==='taken'?'Принят':'Пропущен'}</span><button className="text-button" aria-label={`Изменить отметку ${row.name} в ${row.time}`} onClick={()=>setEditing(row.id)}>Изменить</button></>}</div>
    </article>)}</div>}
    <small className="daily-dose-caption">По вашим отметкам о приёме</small>
  </section>;
}
