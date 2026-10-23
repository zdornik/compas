import {useCallback,useEffect,useRef,useState} from 'react';
import {CalendarBlank,Check,Plus,ArrowClockwise} from '@phosphor-icons/react';
import {appointmentRequest} from './persistence.js';
import {useCareUpdates} from './MedicalProfile.jsx';
import {usePollingResource} from './usePollingResource.js';
import {Modal} from './components.jsx';
import {DatePicker,TimeWheel} from './DateTimeControls.jsx';
import {DiaryCalendar} from './DiaryCalendar.jsx';
import {calendarPeriod} from './calendar.js';
import {dayKey} from './domain.js';
import {appointmentDay,appointmentDays,appointmentDate,appointmentTime,appointmentStart,appointmentDayAfter,appointmentStatus} from './appointments.js';
import './appointments.css';

function useAppointments({owner,role,active,query}){
 const [after,setAfter]=useState('');
 const base=owner+':'+role+':'+query,selection=after.startsWith(base+'|')?after.slice(base.length+1):'';
 const path='/api/appointments?'+query+(selection?'&after='+encodeURIComponent(selection):'');
 const state=usePollingResource({path,role,owner,active:active&&Boolean(owner),interval:10000,load:signal=>appointmentRequest(path,{role,signal})});
 return {...state,next:()=>setAfter(base+'|'+state.data.nextAfter),first:()=>setAfter(''),paged:Boolean(selection)};
}

function AppointmentForm({role,links,draft,onChange,onClose,onSaved}){
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 const change=patch=>{onChange({...draft,...patch});setError('');};
 const submit=async event=>{
  event.preventDefault();if(pending)return;setPending(true);setError('');
  try{const saved=await appointmentRequest('/api/appointments',{role,method:'POST',body:{id:draft.id,linkId:draft.linkId,startsAt:appointmentStart(draft.day,draft.time),durationMinutes:Number(draft.durationMinutes),format:draft.format,note:draft.note}});await onSaved(saved);onClose();}
  catch(error){setError(error.message);}finally{setPending(false);}
 };
 return <Modal title={role==='doctor'?'Назначить приём':'Запросить приём'} closeDisabled={pending} onClose={onClose} className="ap-form-modal"><form className="modal-body ap-form" onSubmit={submit}><fieldset disabled={pending}>
  <p className="secondary">{role==='doctor'?'Приём сразу появится в расписании пациента.':'Предложите удобное время. Оно будет забронировано после подтверждения врача.'}</p>
  <label className="med-field"><span>{role==='doctor'?'Пациент':'Врач'}</span><select required aria-label={role==='doctor'?'Пациент для приёма':'Врач для приёма'} value={draft.linkId} onChange={event=>change({linkId:event.target.value})}><option value="">Выберите {role==='doctor'?'пациента':'врача'}</option>{links.map(link=><option value={link.id} key={link.id}>{role==='doctor'?link.patientName:link.doctorName}</option>)}</select></label>
  <DatePicker label="Дата приёма" value={draft.day} min={dayKey()} max={appointmentDayAfter(dayKey(),365)} disabled={pending} onChange={day=>change({day})}/>
  <div inert={pending}><p className="ap-time-label">Время приёма · МСК (UTC+3)</p><TimeWheel value={draft.time} onChange={time=>change({time})}/></div>
  <div className="ap-form-columns"><label className="med-field"><span>Длительность</span><select aria-label="Длительность приёма" value={draft.durationMinutes} onChange={event=>change({durationMinutes:Number(event.target.value)})}>{[15,30,45,60,90,120,180].map(value=><option key={value} value={value}>{value} минут</option>)}</select></label><label className="med-field"><span>Формат</span><select aria-label="Формат приёма" value={draft.format} onChange={event=>change({format:event.target.value})}><option value="in_person">Очно</option><option value="online">Онлайн</option></select></label></div>
  <label className="med-field"><span>Комментарий · необязательно</span><textarea aria-label="Комментарий к приёму" rows={3} maxLength={1000} value={draft.note} onChange={event=>change({note:event.target.value})} placeholder="Тема приёма или договорённости о встрече"/></label>
  {error&&<p className="journal-error" role="alert">{error}</p>}<button className="primary full-width" disabled={pending||!links.some(link=>link.id===draft.linkId)}>{pending?'Сохраняем…':role==='doctor'?'Назначить приём':'Отправить запрос'}<Check size={18}/></button>
 </fieldset></form></Modal>;
}

function AppointmentRow({value,role,onChange}){
 const [pending,setPending]=useState(false),[error,setError]=useState(''),[cancel,setCancel]=useState(false),attempt=useRef(null);
 const future=Date.parse(value.endsAt)>Date.now(),canCancel=future&&['requested','confirmed'].includes(value.status);
 const act=async action=>{
  if(pending)return;setPending(true);setError('');
  const key=value.id+':'+value.revision+':'+action;
  if(attempt.current?.key!==key)attempt.current={key,input:{mutationId:crypto.randomUUID(),expectedRevision:value.revision}};
  try{await appointmentRequest('/api/appointments/'+value.id+'/'+action,{role,method:'POST',body:attempt.current.input});setCancel(false);await onChange();}
  catch(error){setError(error.message);if(error.status===409)await onChange();}finally{setPending(false);}
 };
 return <article className={'ap-row ap-status-'+value.status}><header><CalendarBlank size={21}/><div><strong>{appointmentDate(value.startsAt)} · {appointmentTime(value.startsAt)}–{appointmentTime(value.endsAt)}</strong><small>МСК · {value.format==='online'?'Онлайн':'Очно'} · {Math.round((Date.parse(value.endsAt)-Date.parse(value.startsAt))/60000)} минут</small></div></header><h3>{role==='doctor'?value.patientName:value.doctorName}</h3><p className="ap-status">{appointmentStatus(value)}</p>{value.note&&<p className="ap-note">{value.note}</p>}
  <div className="ap-actions">{role==='doctor'&&value.status==='requested'&&<>{Date.parse(value.startsAt)>Date.now()&&<button className="secondary-button" disabled={pending} onClick={()=>act('confirm')}>Подтвердить</button>}<button className="text-button" disabled={pending} onClick={()=>act('decline')}>Отклонить</button></>}{canCancel&&!cancel&&<button className="text-button" disabled={pending} onClick={()=>setCancel(true)}>{value.status==='requested'?'Отозвать запрос':'Отменить приём'}</button>}</div>
  {cancel&&canCancel&&<div className="ap-cancel"><p>{value.status==='requested'?'Отозвать запрос на это время?':'Отменить приём и освободить это время?'}</p><div className="ap-actions"><button className="secondary-button" disabled={pending} onClick={()=>act('cancel')}>Да, отменить</button><button className="text-button" disabled={pending} onClick={()=>setCancel(false)}>Сохранить запись</button></div></div>}{error&&<p className="journal-error" role="alert">{error}</p>}
 </article>;
}

function AppointmentList({state,role,empty='Приёмов пока нет.'}){
 return <><div className="ap-list">{state.data?.items.map(value=><AppointmentRow key={value.id} value={value} role={role} onChange={state.reload}/>)}{!state.data&&!state.error&&<p className="secondary" role="status">Загружаем расписание…</p>}{state.data&&!state.data.items.length&&<p className="secondary">{empty}</p>}</div>{state.error&&<p className="journal-error" role="alert">{state.error}</p>}<div className="ap-actions">{state.paged&&<button className="text-button" onClick={state.first}>К началу списка</button>}{state.data?.nextAfter&&<button className="secondary-button" onClick={state.next}>Следующие приёмы</button>}<button className="text-button" onClick={state.reload}><ArrowClockwise size={16}/>Обновить</button></div></>;
}

export function Appointments({owner,role='patient',active=true,onManageConnections,onRequestAuth}){
 const Heading=role==='doctor'?'h1':'h2';
 const doctor=role==='doctor',today=dayKey(),initial=calendarPeriod('week',today),[selected,setSelected]=useState(today),[range,setRange]=useState({from:initial.days[0],to:initial.days.at(-1)}),[open,setOpen]=useState(false),[draft,setDraft]=useState(null);
 const {care,error:careError}=useCareUpdates(active,role),links=(doctor?care?.doctorLinks:care?.patientLinks)?.filter(link=>link.status==='active')||[];
 const periodChanged=useCallback(({from,to})=>setRange(old=>old.from===from&&old.to===to?old:{from,to}),[]);
 const query=doctor?new URLSearchParams({...range,limit:'200'}).toString():new URLSearchParams({from:today,to:appointmentDayAfter(today,365),limit:'100'}).toString();
 const state=useAppointments({owner,role,active,query}),requests=useAppointments({owner,role,active:active&&doctor,query:'status=requested&limit=100'});
 const create=()=>{if(!draft)setDraft({id:crypto.randomUUID(),linkId:links.length===1?links[0].id:'',day:doctor&&selected>today?selected:appointmentDayAfter(today,1),time:'09:00',durationMinutes:30,format:'in_person',note:''});setOpen(true);};
 useEffect(()=>{if(!active)setOpen(false);},[active]);
 const saved=async value=>{setDraft(null);if(doctor)setSelected(appointmentDay(value));await Promise.all([state.reload(),doctor?requests.reload():Promise.resolve()]);};
 const rows=state.data?.items||[],dayRows=rows.filter(value=>appointmentDays(value).includes(selected)),calendarRows=rows.filter(value=>['requested','confirmed'].includes(value.status)).flatMap(value=>appointmentDays(value).map(day=>({id:value.id+':'+day,day,type:'appointment'})));
 return <section className={doctor?'ap-doctor':'surface ap-patient'} aria-label={doctor?'Расписание приёмов':'Приёмы и запросы'}><header className="ap-heading"><div>{doctor&&<p className="dw-overline">РАСПИСАНИЕ</p>}<Heading>{doctor?'Календарь':'Приёмы и запросы'}</Heading><p className="secondary">{doctor?'Назначайте приёмы и подтверждайте запросы пациентов.':'Врач может назначить приём, а вы — предложить удобное время.'}</p></div><button className={doctor?'dw-primary':'secondary-button'} disabled={!owner||!links.length} onClick={create}><Plus size={18}/>{draft?'Продолжить запись':doctor?'Назначить приём':'Запросить приём'}</button></header>
  {!owner?<div className="ap-empty"><p>Для записи на приём войдите в учётную запись.</p>{onRequestAuth&&<button className="secondary-button" onClick={onRequestAuth}>Войти в аккаунт</button>}</div>:<>{care&&!links.length&&<div className="ap-empty"><p>{doctor?'Сначала подключите пациента и дождитесь его подтверждения.':'Сначала подключите врача и подтвердите его запрос выше.'}</p>{onManageConnections&&<button className="secondary-button" onClick={onManageConnections}>Управление подключениями</button>}</div>}{doctor?<>
   <div className="dw-shared-calendar ap-calendar"><DiaryCalendar entries={calendarRows} selected={selected} onSelect={setSelected} purpose="appointments" onPeriodChange={periodChanged}/><section className="surface ap-calendar-day"><h2>{appointmentDate(selected+'T12:00:00+03:00')}</h2>{state.error&&<p className="journal-error" role="alert">{state.error}</p>}{!state.data&&!state.error?<p className="secondary">Загружаем расписание…</p>:!dayRows.length?<p className="secondary">На этот день приёмов нет.</p>:dayRows.map(value=><AppointmentRow key={value.id} value={value} role={role} onChange={async()=>{await Promise.all([state.reload(),requests.reload()]);}}/>)}{state.data?.nextAfter&&<p className="input-hint">В периоде есть ещё записи. Откройте следующую страницу ниже.</p>}<div className="ap-actions">{state.paged&&<button className="text-button" onClick={state.first}>К началу периода</button>}{state.data?.nextAfter&&<button className="secondary-button" onClick={state.next}>Следующие приёмы</button>}</div></section></div>
   <section className="surface ap-requests"><h2>Запросы пациентов</h2><p className="secondary">Предложенное время ожидает вашего подтверждения.</p><AppointmentList role={role} state={{...requests,reload:async()=>{await Promise.all([state.reload(),requests.reload()]);}}} empty="Новых запросов на будущие даты нет."/></section>
  </>:<AppointmentList state={state} role={role}/>}</>}{careError&&<p className="journal-error" role="alert">{careError}</p>}{open&&draft&&<AppointmentForm role={role} links={links} draft={draft} onChange={setDraft} onClose={()=>setOpen(false)} onSaved={saved}/>}
 </section>;
}
