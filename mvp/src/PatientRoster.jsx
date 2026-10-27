import {useEffect,useState} from 'react';
import {loadCareRoster} from './persistence.js';
import {usePollingResource} from './usePollingResource.js';
import {TrackingCards} from './TrackingCards.jsx';
import './tracking.css';
const empty={q:'',diagnosis:'',medication:''};
export function PatientRoster({owner,active=true,overview=false,onSelect,links=[]}){
 const [filters,setFilters]=useState(empty),[query,setQuery]=useState(empty),[before,setBefore]=useState(null);
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(filters);setBefore(null);},250);return()=>clearTimeout(timer);},[filters]);
 const params={...query,...(before?{before}:{}),limit:20},path='/api/care/roster?'+new URLSearchParams(params);
 const state=usePollingResource({path,role:'doctor',owner,active,interval:30000,load:signal=>loadCareRoster(params,signal)}),items=state.data?.items||[];
 const update=(name,value)=>setFilters(old=>({...old,[name]:value}));
 return <div className="trk-roster">{overview&&<div className="trk-overview-stats"><article><small>Активных подключений</small><strong>{links.filter(link=>link.status==='active').length}</strong><span>Доступ подтверждён пациентами</span></article><article><small>Отметки настроения</small><strong>{items.filter(item=>item.tracking?.mood).length}</strong><span>За 14 дней · на этой странице</span></article><article><small>Результаты опросников</small><strong>{items.filter(item=>item.tracking?.scales.phq9||item.tracking?.scales.gad7).length}</strong><span>Пациентов на этой странице</span></article></div>}
  <form className="trk-filters" onSubmit={event=>event.preventDefault()} aria-label="Фильтры пациентов"><label>Пациент<input type="search" value={filters.q} onChange={event=>update('q',event.target.value)} placeholder="Имя или фамилия"/></label><label>Диагноз<input value={filters.diagnosis} onChange={event=>update('diagnosis',event.target.value)} placeholder="Название или МКБ-10"/></label><label>Препарат<input value={filters.medication} onChange={event=>update('medication',event.target.value)} placeholder="Название препарата"/></label><button type="button" className="text-button" onClick={()=>{setFilters(empty);setBefore(null);}}>Сбросить</button></form>
  {state.loading&&<p role="status" className="trk-help">Загружаем показатели пациентов…</p>}{state.error&&<p role="alert" className="journal-error">{state.error} <button className="text-button" onClick={state.reload}>Повторить</button></p>}
  {items.map(item=><article className="trk-patient-card" key={item.id}><header><button className="cp-linked-patient trk-patient-open" disabled={item.status!=='active'} onClick={()=>onSelect(item.id)}><span className="trk-avatar">{item.patientName.slice(0,1)}</span><span><strong>{item.patientName}</strong><small>{item.status==='active'?'Открыть карту пациента':'Доступ к медицинским данным закрыт'}</small></span><span aria-hidden="true">→</span></button><div className="trk-profile-tags">{item.conditions.map((value,index)=><span key={index}>{value.code?value.code+' · ':''}{value.name}</span>)}</div></header>{item.status==='active'&&<><TrackingCards tracking={item.tracking}/><p className="trk-patient-meds">В профиле и плане: {item.medications.map(value=>value.name).join(' · ')||'Не указано'}</p></>}</article>)}
  {state.data&&!items.length&&<p className="trk-help">{state.data.nextCursor?'В этой части списка совпадений нет. Продолжите поиск.':'Пациентов с такими фильтрами нет.'}</p>}
  <div className="cp-actions">{before&&<button className="text-button" onClick={()=>setBefore(null)}>В начало списка</button>}{state.data?.nextCursor&&<button className="secondary-button" onClick={()=>setBefore(state.data.nextCursor)}>Следующие пациенты</button>}</div>
  <p className="trk-help">Шкалы отражают отдельные показатели. PHQ-9 и GAD-7 — скрининг, а не диагноз. Пробелы в данных не заменяются оценками.</p>
 </div>;
}
