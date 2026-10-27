import {MoodTrend} from './MoodTrend.jsx';
import {useEntryHistory,HistoryStatus} from './useEntryHistory.jsx';
import {mergeEntries} from './history-data.js';
import {JournalNotes} from './JournalNotes.jsx';
import { useCallback, useMemo, useState } from 'react';
import { BookOpen, CaretRight, Check, Clock, FileText, MagnifyingGlass, Moon, Pill, Plus, X } from '@phosphor-icons/react';
import { Modal } from './components.jsx';
import { DiaryCalendar } from './DiaryCalendar.jsx';
import { MedicationEditor } from './MedicationEditor.jsx';
import { SlidingTabs } from './SlidingTabs.jsx';
import { MOODS, dateLabel, timeLabel, dayKey } from './domain.js';
import { addDays, doseLabel, makeMedicationPlan, mealLabel, normalizeMedicationConfig, stageForDay } from './medications.js';
import { SCALES,ANSWER_OPTIONS,IMPACT_OPTIONS,scoreAssessment } from './assessments.js';
import { DOCTOR_DEMO_DAY, diaryPeriod, durationLabel, sleepMinutes, sleepSummary } from './doctor-care.js';
import './sliding-tabs.css';
import './doctor-care.css';
const date=day=>dateLabel(day+'T12:00:00Z');
const periods=[{id:7,label:'7 дней'},{id:14,label:'14 дней'},{id:30,label:'Месяц'}];

export function CareDynamics({entries,days,onDays,selected,onSelect,demo=true}) {
 const rows=useMemo(()=>diaryPeriod(entries,days,demo?DOCTOR_DEMO_DAY:dayKey()),[entries,days,demo]);
 const dates=Array.from({length:days},(_,i)=>addDays(demo?DOCTOR_DEMO_DAY:dayKey(),i-days+1));
 const moods=rows.filter(row=>row.type==='mood'),sleep=sleepSummary(rows),last=moods[0];
 const counts=MOODS.map((mood,index)=>({name:mood.name,count:moods.filter(row=>row.value===index).length}));
 return <section className="dc-dynamics"><div className="dw-record-toolbar"><div><h2>Настроение и сон</h2><p>{date(dates[0])} — {date(dates.at(-1))} · {demo?'вымышленные записи':'данные пациента'}</p></div><SlidingTabs items={periods} value={days} onChange={onDays} label="Период наблюдения" className="dc-period-tabs"/></div>
 <div className="dc-stat-row"><div><small>Дней с отметкой</small><strong>{new Set(moods.map(row=>row.day)).size}</strong><span>из {days} дней с отметкой</span></div><div><small>Последнее состояние</small><strong className="dc-stat-word">{last?MOODS[last.value].name:'Нет отметок'}</strong><span>{last?date(last.day):'Данные не добавлены'}</span></div><div><small>Средняя длительность сна</small><strong>{sleep.mean===null?'—':durationLabel(sleep.mean)}</strong><span>по {sleep.count} записям</span></div></div>
 <div className="dc-charts"><MoodTrend entries={rows} from={dates[0]} to={dates.at(-1)} selected={selected} onSelect={onSelect}/><section className="dc-chart-card"><header><Moon size={18}/><h3>Сон</h3><span>Часы, по записям</span></header><div className="dc-sleep-plot"><div className="dc-axis"><span>12 ч</span><span>6 ч</span><span>0 ч</span></div><div className="dc-plot-columns">{dates.map(day=>{const entry=rows.find(row=>row.day===day&&row.type==='sleep');return <button key={day} className={'dc-sleep-column '+(selected===day?'selected':'')} onClick={()=>onSelect(day)} aria-label={`${date(day)}: ${entry?'сон '+durationLabel(sleepMinutes(entry)):'нет записи сна'}`} aria-pressed={selected===day}>{entry?<i style={{height:`${Math.min(100,sleepMinutes(entry)/720*100)}%`}}/>:<span className="dc-missing-point"/>}</button>;})}</div></div><div className="dc-chart-dates"><span>{date(dates[0])}</span><span>{date(dates.at(-1))}</span></div><p className="dc-chart-help">Длительность сна без оценки нормы. Пробелы не заполняются.</p></section></div>
 {moods.length>0&&<details className="dc-distribution"><summary>Распределение отметок состояния</summary>{counts.map((item,index)=><div key={item.name}><span>{item.name}</span><i style={{'--share':item.count/moods.length*100+'%'}} className={'tone-'+MOODS[index].tone}/><strong>{item.count}</strong></div>)}</details>}
 </section>;
}

export function CareDiary({patient,entries:localEntries,active=true,historyAvailable=false,days,onDays,selected,onSelect,showCharts=true,demo=true,linkId,owner}) {
 const [filter,setFilter]=useState('Все записи'),[mode,setMode]=useState('Самочувствие');
 const [period,setPeriod]=useState({from:selected,to:selected});
 const onPeriodChange=useCallback(value=>setPeriod(old=>old.from===value.from&&old.to===value.to?old:value),[]);
 const enabled=!demo&&historyAvailable,reading=active&&mode!=='Записи';
 const history=useEntryHistory({kind:'observations',...period,active:reading,enabled,linkId,owner});
 const chart=useEntryHistory({kind:'observations',from:addDays(dayKey(),1-days),to:dayKey(),active:reading&&mode==='Самочувствие'&&showCharts,enabled,linkId,owner});
 const day=useEntryHistory({kind:'observations',from:selected,to:selected,active:reading&&(selected<period.from||selected>period.to),enabled,linkId,owner});
 const entries=mergeEntries(history.entries,day.entries,chart.entries,localEntries);
 const dayRows=entries.filter(row=>['mood','sleep'].includes(row.type)&&row.day===selected&&(filter==='Все записи'||row.type===(filter==='Сон'?'sleep':'mood')));
 return <><div className="dw-record-toolbar"><div><h2>Дневник пациента</h2><p>Исходные отметки состояния и сна</p></div></div><SlidingTabs items={['Самочувствие','Записи','Опросники']} value={mode} onChange={setMode} label="Раздел дневника пациента" className="dc-diary-modes"/>{mode!=='Записи'&&<><HistoryStatus resource={history}/><HistoryStatus resource={chart}/><HistoryStatus resource={day}/></>}{mode==='Самочувствие'?<>{showCharts&&<CareDynamics demo={demo} entries={entries} days={days} onDays={onDays} selected={selected} onSelect={onSelect}/>}
 <div className="dc-diary-layout"><DiaryCalendar entries={entries} selected={selected} onSelect={onSelect} onPeriodChange={onPeriodChange}/><section className="dc-day-records"><header><h3>{date(selected)}</h3><SlidingTabs items={['Все записи','Состояние','Сон']} value={filter} onChange={setFilter} label="Тип записей дневника"/></header>{dayRows.map(entry=><article key={entry.id} className="dc-source-entry"><small>{timeLabel(entry.at)} · {demo?'вымышленная запись':'отметка пациента'}</small>{entry.type==='mood'?<><h3 className={'dc-entry-tone tone-'+MOODS[entry.value].tone}><BookOpen size={19}/>{MOODS[entry.value].name}</h3><div className="dw-emotion-words">{(entry.words||[]).map(word=><span key={word}>{word}</span>)}</div><p>{entry.note}</p><small>Факторы: {(entry.factors||[]).join(', ')}</small></>:<><h3><Moon size={19}/>Сон · {durationLabel(sleepMinutes(entry))}</h3><p>Качество: {entry.quality}</p>{entry.note&&<p>{entry.note}</p>}</>}</article>)}{!dayRows.length&&<div className="dw-empty"><BookOpen size={26}/><h3>За этот день нет записей</h3><p>Выберите другую дату или тип записи.</p></div>}</section></div></>:mode==='Записи'?(demo?<CareNotes entries={entries} demo/>:<JournalNotes active={active} linkId={linkId} owner={owner}/>):<>{!demo&&<><p className="dc-care-caption">Результаты за выбранный период календаря.</p><DiaryCalendar entries={entries} selected={selected} onSelect={onSelect} onPeriodChange={onPeriodChange}/></>}<CareAssessments entries={demo?entries:entries.filter(row=>row.day>=period.from&&row.day<=period.to)} demo={demo}/></>}</>;
}

function CareNotes({entries,demo=true}) {
 const [query,setQuery]=useState(''),[selected,setSelected]=useState(null);
 const notes=entries.filter(entry=>entry.type==='journal'&&(demo?entry.sharedWithDoctor:true)&&(`${entry.title} ${entry.body}`).toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
 return <section className="dc-notes"><p className="dc-care-caption">{demo?'Вымышленные личные записи, которыми пациент поделился с врачом.':'Здесь доступны только записи с явным разрешением пациента. Личные тексты по умолчанию не передаются.'}</p><label className="dw-search"><MagnifyingGlass size={18}/><input value={query} onChange={event=>setQuery(event.target.value)} aria-label="Поиск по записям пациента" placeholder="Найти слово в записях"/></label>{notes.map(note=><article key={note.id}><button aria-expanded={selected===note.id} onClick={()=>setSelected(selected===note.id?null:note.id)}><span><small>{date(note.day)}</small><strong>{note.title}</strong></span><CaretRight size={17}/></button>{selected===note.id&&<div className="dc-note-body">{note.body}</div>}</article>)}{!notes.length&&<p className="dc-care-caption">Доступных записей не найдено.</p>}</section>;
}
export function CareAssessments({entries,demo=true}) {
 const rows=entries.filter(entry=>entry.type==='assessment');
 return <section className="dc-assessments"><h3>Опросники</h3><p className="dc-care-caption">{demo?'Вымышленные результаты. ':''}Баллы рассчитаны по ответам; скрининг не является диагнозом.</p>{rows.map(entry=>{const scale=SCALES[entry.scaleId],result=scoreAssessment(entry.scaleId,entry.answers);return <details key={entry.id}><summary><FileText size={20}/><span><strong>{scale.name}</strong><small>{date(entry.day)}</small></span><b>{result.score}<small> / {result.max}</small></b><CaretRight size={16}/></summary><div className="dc-assessment-content"><p>{result.severity}</p><ol>{scale.questions.map((question,index)=><li key={index}><p>{question}</p><strong>{ANSWER_OPTIONS[entry.answers[index]]}</strong></li>)}</ol>{entry.impact!==null&&<p>Влияние на повседневные дела: {IMPACT_OPTIONS[entry.impact]}</p>}<a href={scale.source} target="_blank" rel="noreferrer">Оригинальная русская форма {scale.name}<FileText size={14}/></a></div></details>;})}{!rows.length&&<p className="dc-care-caption">Результатов пока нет.</p>}</section>;
}

export function PlanDetails({plan}) {
 let start=plan.startDate;
 return <><dl className="dw-definition"><div><dt>Начало</dt><dd>{date(plan.startDate)}</dd></div>{plan.endDate&&<div><dt>Окончание</dt><dd>{date(plan.endDate)}</dd></div>}<div><dt>Ежедневно</dt><dd>{plan.times.join(' · ')}</dd></div>{!plan.titration.enabled&&<div><dt>На один приём</dt><dd>{doseLabel(plan)}</dd></div>}{mealLabel(plan.meal)&&<div><dt>Связь с едой</dt><dd>{mealLabel(plan.meal)}</dd></div>}</dl>{plan.titration.enabled&&<ol className="dc-plan-stages">{plan.titration.stages.map((stage,index)=>{const end=addDays(start,stage.days-1),from=start;start=addDays(end,1);return <li key={index}><span>{index+1}</span><div><strong>{doseLabel({...plan,...stage})}</strong><small>{date(from)} — {date(end)} · {stage.days} дн.</small></div></li>;})}</ol>}{plan.titration.enabled&&<p className="dw-help-text">После этапов: {plan.titration.after==='maintain'?'продолжать последнюю дозу':'завершить схему'}.</p>}{plan.instructions&&<p className="dc-plan-note">{plan.instructions}</p>}</>;
}
export function CareTreatment({patient,plans,onEdit,onArchive}) {
 const [filter,setFilter]=useState('Действующие'),[confirm,setConfirm]=useState(null);
 const visible=plans.filter(plan=>filter==='История'?plan.archived:!plan.archived);
 return <><div className="dw-record-toolbar"><div><h2>План лечения</h2><p>Схемы для вымышленного пациента {patient.name}. Сохраняются до перезагрузки.</p></div><button className="dw-primary" onClick={()=>onEdit(null)}><Plus size={18}/>Новое назначение</button></div><SlidingTabs items={['Действующие','История']} value={filter} onChange={setFilter} label="Назначения пациента" className="dc-treatment-tabs"/>
 <div className="dc-plans">{visible.map(plan=><article className="dw-panel dc-plan" key={plan.id}><header><Pill size={22}/><div><h3>{plan.name}</h3><small>{plan.archived?'Завершена':plan.startDate>DOCTOR_DEMO_DAY?'Начнётся '+date(plan.startDate):'Схема в демо'} · версия {plan.revision}</small></div></header><PlanDetails plan={plan}/><div className="dc-plan-actions">{!plan.archived&&<><button className="dw-outline-button" onClick={()=>onEdit(plan)}>Изменить схему</button><button className="dw-text-button" onClick={()=>setConfirm(plan.id)}>Завершить</button></>}{confirm===plan.id&&<div className="dc-archive-confirm"><p>Завершить эту схему? Она останется в истории.</p><button className="dw-outline-button" onClick={()=>{onArchive(plan);setConfirm(null);}}>Завершить в демо</button><button className="dw-text-button" onClick={()=>setConfirm(null)}>Отмена</button></div>}</div>{plan.history.length>0&&<details className="dc-plan-history"><summary>Предыдущие версии · {plan.history.length}</summary>{plan.history.map(version=><section key={version.revision}><h4>Версия {version.revision}</h4><PlanDetails plan={version}/></section>)}</details>}</article>)}</div>{!visible.length&&<div className="dw-empty"><Pill size={29}/><h3>{filter==='История'?'Завершённых схем пока нет':'Назначений пока нет'}</h3><p>{filter==='История'?'После завершения схема появится здесь.':'Добавьте препарат и точную схему приёма для проверки сценария.'}</p></div>}</>;
}

export function PrescriptionSheet({patient,draft,onChange,onClose,onSave}) {
 const [review,setReview]=useState(null),[error,setError]=useState('');
 return <Modal title={review?'Проверить назначение':'Назначение · '+patient.name} className="medication-sheet dc-prescription" onClose={onClose} headerDetail={<p>Демонстрация · данные сохранятся до перезагрузки страницы</p>}>
 {review?<div className="dc-prescription-review"><p className="dc-review-person">{patient.name}</p><h3>{review.name}</h3><PlanDetails plan={review}/><p className="dw-help-text">Схема введена вручную. Автоматическая проверка доз, противопоказаний и совместимости не выполнена.</p>{error&&<p role="alert" className="journal-error">{error}</p>}<div className="dc-review-actions"><button className="dw-outline-button" onClick={()=>setReview(null)}>Вернуться к форме</button><button className="dw-primary" onClick={()=>{try{onSave(draft);onClose();}catch(error){setError(error.message);}}}><Check size={17}/>Сохранить назначение в демо</button></div></div>:<MedicationEditor draft={draft} onChange={value=>{onChange(value);setError('');}} onSubmit={()=>{try{setReview(normalizeMedicationConfig(draft));setError('');}catch(error){setError(error.message);}}} storageReady pending={false} error={error} caption="Введите препарат и точную схему приёма. Дозы не подбираются автоматически." submitLabel="Проверить назначение"/>}
 </Modal>;
}
