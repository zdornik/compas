import {useState} from 'react';
import {CaretLeft,CaretRight,Check,Clock,Minus,Pill,Plus,PencilSimple,FileText,Heart,ShieldCheck} from '@phosphor-icons/react';
import {calendarPeriod,moveCalendar} from './calendar.js';
import {CalendarMotion} from './CalendarMotion.jsx';
import {SlidingTabs} from './SlidingTabs.jsx';
import {useEntryHistory,HistoryStatus} from './useEntryHistory.jsx';
import {mergeEntries} from './history-data.js';
import {medicationSchedule,doseLabel,mealLabel} from './medications.js';
import {dayKey,dateLabel,timeLabel} from './domain.js';
import {PlanDetails} from './DoctorCare.jsx';
import {usePollingResource} from './usePollingResource.js';
import {clinicalNotesRequest} from './persistence.js';
import './doctor-patient-layouts.css';
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const pretty=day=>dateLabel(day+'T12:00:00+03:00');
function usePrivateNotes(linkId,owner,active){const params={limit:20},path='/api/care/patients/'+linkId+'/clinical-notes?'+new URLSearchParams(params);return usePollingResource({role:'doctor',owner,path,active,load:signal=>clinicalNotesRequest(linkId,{params,signal})});}
function DoseStatus({row,day}){
 const past=day<dayKey()||(day===dayKey()&&row.time<timeLabel(new Date()));
 const text=row.status==='taken'?'Принят':row.status==='skipped'?'Пропущен':past?'Нет отметки':'По расписанию';
 const Icon=row.status==='taken'?Check:row.status==='skipped'?Minus:Clock;
 return <span className={`dpl-dose-status ${row.status}`}><Icon size={13}/>{text}</span>;
}

export function DoctorTreatmentLayout({entries:localEntries,profile,linkId,owner,active,enabled,selected,onSelect,onPrescribe,onEditPlan,onEditMedications}){
 const [view,setView]=useState('week'),[anchor,setAnchor]=useState(selected),[direction,setDirection]=useState(0);
 const {key,days,offset}=calendarPeriod(view,anchor),history=useEntryHistory({kind:'doses',from:days[0],to:days.at(-1),linkId,owner,active,enabled});
 const entries=mergeEntries(history.entries,localEntries),plans=localEntries.filter(row=>row.type==='medication-plan');
 const chosen=medicationSchedule(entries,selected),current=plans.filter(plan=>!plan.archived),past=plans.filter(plan=>plan.archived);
 const move=n=>{setDirection(n);setAnchor(old=>moveCalendar(view,old,n));};
 const changeView=next=>{if(days.includes(selected))setAnchor(selected);setDirection(0);setView(next);};
 const choose=day=>{onSelect(day);};
 const period=view==='week'?`${pretty(days[0])} — ${pretty(days.at(-1))}`:new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(anchor+'T12:00:00Z'));
 return <div className="dpl-treatment-layout"><section className="dpl-panel dpl-calendar-panel">
  <header className="dpl-section-header"><div><h2>Календарь приёма</h2><p>Препараты, расписание и отметки пациента</p></div><div className="dpl-calendar-tools"><button className="icon-button" aria-label="Предыдущий период приёма" onClick={()=>move(-1)}><CaretLeft size={18}/></button><SlidingTabs items={[{id:'week',label:'Неделя'},{id:'month',label:'Месяц'}]} value={view} onChange={changeView} label="Период календаря приёма"/><button className="icon-button" aria-label="Следующий период приёма" onClick={()=>move(1)}><CaretRight size={18}/></button></div></header>
  <HistoryStatus resource={history}/><CalendarMotion pageKey={key} direction={direction}><h3 className="dpl-calendar-period" aria-live="polite">{period}</h3><div className={`dpl-calendar-scroll ${view}`}><div className={`dpl-calendar-grid ${view}`}>
   {view==='month'&&weekdays.map(day=><span className="dpl-weekday" key={day}>{day}</span>)}
   {Array.from({length:offset},(_,i)=><span key={'space-'+i} aria-hidden="true"/>)}
   {days.map(day=>{const rows=medicationSchedule(entries,day);return <button key={day} className={`dpl-day ${day===selected?'selected':''} ${day===dayKey()?'today':''}`} aria-pressed={day===selected} aria-label={`${pretty(day)}, приёмов по расписанию: ${rows.length}`} onClick={()=>choose(day)}><span className="dpl-day-heading">{view==='week'&&<small>{weekdays[(new Date(day+'T12:00:00Z').getUTCDay()+6)%7]}</small>}<strong>{Number(day.slice(-2))}</strong></span><span className="dpl-day-doses">{rows.slice(0,view==='week'?3:2).map(row=><span key={row.id} className={`dpl-mini-dose ${row.status}`}><span><b>{row.status==='taken'?'✓':row.status==='skipped'?'−':'·'}</b><time>{row.time}</time></span>{view==='week'&&<small>{row.name}</small>}</span>)}{rows.length>(view==='week'?3:2)&&<small>Ещё {rows.length-(view==='week'?3:2)}</small>}{!rows.length&&<span className="dpl-day-empty">—</span>}</span></button>;})}
  </div></div></CalendarMotion>
  <div className="dpl-calendar-legend"><span>✓ Принят</span><span>− Пропущен</span><span>· По расписанию / без отметки</span></div>
  <section className="dpl-selected-day" aria-label="Приёмы выбранного дня"><h3>{pretty(selected)}</h3>{chosen.map(row=><article className="dpl-dose-detail" key={row.id}><time>{row.time}</time><span className="dpl-icon"><Pill size={20}/></span><div><strong>{row.name}</strong><small>{doseLabel(row)}{mealLabel(row.meal)?' · '+mealLabel(row.meal):''}</small></div><DoseStatus row={row} day={selected}/></article>)}{!chosen.length&&<p className="dpl-empty-copy">На этот день приёмы не запланированы.</p>}</section>
  <p className="dpl-footnote">Отметки делает пациент. Отсутствие отметки не означает пропуск; календарь не подтверждает фактический приём.</p>
 </section>
 <aside className="dpl-treatment-side"><section className="dpl-panel"><header className="dpl-section-header"><h2>Назначенные препараты</h2><button className="icon-button" aria-label="Назначить новый препарат" onClick={onPrescribe}><Plus size={19}/></button></header><div className="dpl-prescriptions">{current.map(plan=><article className="dpl-prescription" key={plan.id}><div className="dpl-prescription-heading"><span className="dpl-icon"><Pill size={20}/></span><div><h3>{plan.name}</h3><small>{plan.origin==='doctor'?'Назначил '+plan.prescriberName:'Внесено пациентом'}</small></div>{plan.origin==='doctor'&&plan.careLinkId===linkId&&<button className="icon-button" aria-label={'Изменить назначение '+plan.name} onClick={()=>onEditPlan(plan)}><PencilSimple size={16}/></button>}</div><p>{plan.times.join(' · ')} · с {pretty(plan.startDate)}</p><details><summary>Схема и комментарий</summary><PlanDetails plan={plan}/></details></article>)}{!current.length&&<div className="dpl-small-empty"><Pill size={25}/><p>Назначений пока нет</p><button className="text-button" onClick={onPrescribe}>Назначить препарат</button></div>}</div>{past.length>0&&<details className="dpl-archived"><summary>Завершённые схемы · {past.length}</summary>{past.map(plan=><article key={plan.id}><h3>{plan.name}</h3><PlanDetails plan={plan}/></article>)}</details>}</section>
 <section className="dpl-panel"><header className="dpl-section-header"><h2>Со слов пациента</h2><button className="icon-button" aria-label="Уточнить принимаемые препараты" onClick={onEditMedications}><PencilSimple size={16}/></button></header>{profile?.medications?.length?profile.medications.map(item=><article className="dpl-reported-med" key={item.id}><strong>{item.name}</strong>{item.details&&<p>{item.details}</p>}</article>):<p className="dpl-empty-copy">Дополнительные препараты не указаны.</p>}<p className="dpl-footnote">Эти сведения сами по себе не создают расписание.</p></section>
 </aside></div>;
}

export function DoctorMedicalProfile({profile,linkId,owner,active,onEdit,onCreateNote}){
 const notes=usePrivateNotes(linkId,owner,active),items=notes.data?.items||[],anamnesis=items.filter(note=>note.kind==='anamnesis');
 const conditions=profile?.conditions||[];
 return <section className="dpl-medical-profile"><header className="dpl-profile-heading"><div><h2>Медицинский профиль</h2><p>Краткая сводка о здоровье пациента</p></div><button className="dw-outline-button" onClick={onEdit}><PencilSimple size={17}/>Редактировать сведения</button></header>
  <div className="dpl-summary-cards"><article><span className="dpl-icon"><FileText size={20}/></span><div><small>Анамнез</small><strong>{anamnesis.length?'Есть записи врача':'Пока не заполнен'}</strong></div></article><article><span className="dpl-icon"><ShieldCheck size={20}/></span><div><small>Аллергии</small><strong>Нет данных</strong></div></article><article><span className="dpl-icon"><Heart size={20}/></span><div><small>Хронические заболевания</small><strong>{conditions.length?`Записей: ${conditions.length}`:'Не указаны'}</strong></div></article></div>
  <div className="dpl-profile-columns"><div className="dpl-profile-primary"><section className="dpl-panel"><header className="dpl-section-header"><h2><FileText size={21}/>Анамнез</h2><button className="dpl-small-button" onClick={()=>onCreateNote('anamnesis')}><Plus size={15}/>Добавить запись</button></header>{notes.error&&<p className="journal-error">{notes.error}</p>}{notes.loading&&<p className="dpl-empty-copy">Загружаем анамнез…</p>}{anamnesis.slice(0,3).map(note=><article className="dpl-anamnesis" key={note.id}><header><h3>{note.title||'Анамнез'}</h3><small>{pretty(note.day)}</small></header><p>{note.body}</p><small>Запись врача · версия {note.revision}</small></article>)}{!notes.loading&&!anamnesis.length&&<div className="dpl-anamnesis-empty"><div><strong>Жалобы и история состояния</strong><p>Зафиксируйте то, что пациент рассказал на приёме.</p></div><div><strong>Предыдущее лечение и семейный анамнез</strong><p>Добавьте сведения, которые важно сохранить в карте.</p></div></div>}<p className="dpl-footnote">Записи анамнеза доступны только автору при активном подключении пациента.</p></section>
  </div><aside className="dpl-profile-secondary"><section className="dpl-panel"><header className="dpl-section-header"><h2><Heart size={20}/>Хронические заболевания</h2><button className="icon-button" aria-label="Добавить хроническое заболевание" onClick={onEdit}><Plus size={17}/></button></header>{conditions.map(item=><button className="dpl-condition" key={item.id} onClick={onEdit}><span><strong>{item.name}</strong><small>{item.icd10?'МКБ-10 '+item.icd10+' · ':''}{item.source?.type==='doctor'?'Внесено врачом':'Со слов пациента'}</small>{item.details&&<p>{item.details}</p>}</span><CaretRight size={17}/></button>)}{!conditions.length&&<p className="dpl-empty-copy">Подтверждённые заболевания не указаны.</p>}</section>
  </aside></div>
 </section>;
}
