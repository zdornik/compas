import {useEffect,useState} from 'react';
import {Bell,Check,CaretRight,ArrowClockwise} from '@phosphor-icons/react';
import {Modal} from './components.jsx';
import {journalRequest} from './persistence.js';
import {usePollingResource} from './usePollingResource.js';
import './journal-notes.css';

const labels={not_requested:'Обработка не запрошена',queued:'Ожидает обработки',running:'Обрабатывается',retry_wait:'Повторная попытка',failed:'Обработка недоступна',cancelled:'Обработка отменена',succeeded:'Тестовый результат готов'};
export const journalStatus=analysis=>labels[analysis?.status]||'Обработка не запрошена';
function useJournalResource(path,owner,active=true){
 const list=path?.endsWith('/notes')||path==='/api/care/alerts';
 return usePollingResource({path,owner,role:'doctor',active,interval:list?5000:15000,load:signal=>journalRequest(path,{role:'doctor',signal})});
}
function ResourceMessage({state}){return state.error?<p className="journal-error" role="alert">{state.error}</p>:!state.data?<p role="status">Загружаем заметки…</p>:null;}
export function JournalResult({value}){
 if(!value)return null;return <div className="jn-result"><strong>{{routine:'Обычный тестовый сценарий',elevated:'Повышенный тестовый сигнал',urgent:'Срочный тестовый сигнал',indeterminate:'Нужен ручной просмотр'}[value.signalLevel]}</strong><p className="input-hint">Тестовая заглушка. Нейросеть не подключена; это не оценка состояния.</p><p>{value.summary}</p>{value.signals?.map((signal,index)=><div key={index}><blockquote>{signal.sourceSpan.quote}</blockquote><p>{signal.explanation}</p></div>)}</div>;
}
function NoteDetail({path,owner,onClose,alert=false,onChanged}){
 const state=useJournalResource(path,owner),[error,setError]=useState(''),[busy,setBusy]=useState(false),data=state.data;
 const act=async action=>{setBusy(true);setError('');try{await journalRequest(path+'/'+action,{role:'doctor',method:'POST',body:{expectedStateRevision:data.alert.stateRevision}});state.reload();onChanged?.();}catch(error){setError(error.message);}finally{setBusy(false);}};
 return <Modal title={alert?'Уведомление о заметке':'Запись пациента'} onClose={onClose}><div className="modal-body jn-detail"><ResourceMessage state={state}/>{data&&<>{data.patientName&&<p>{data.patientName}</p>}<p className="input-hint">{data.entry.day} · версия {data.entry.revision}{data.currentRevision!==data.entry.revision?' · есть новая редакция':''}</p><h3>{data.entry.title||'Без названия'}</h3><div className="jn-source">{data.entry.body}</div><p>{journalStatus(data.analysis)}</p><JournalResult value={data.analysis.result}/>{alert&&<><p>Статус: {data.alert.state==='acknowledged'?'Принято к рассмотрению':data.alert.state==='seen'?'Просмотрено':'Новое'}</p><div className="jn-actions">{data.alert.state==='new'&&<button className="secondary-button" disabled={busy} onClick={()=>act('seen')}>Отметить просмотр</button>}{data.alert.state!=='acknowledged'&&<button className="secondary-button" disabled={busy} onClick={()=>act('acknowledge')}><Check size={18}/>Принять к рассмотрению</button>}</div><p className="input-hint">Подтверждение не означает, что состояние пациента нормализовалось.</p></>}</>}{error&&<p className="journal-error" role="alert">{error}</p>}</div></Modal>;
}
export function JournalNotes({linkId,owner,active=true}){
 const [before,setBefore]=useState(''),[selected,setSelected]=useState(null),path='/api/care/patients/'+linkId+'/notes',state=useJournalResource(path+(before?'?before='+encodeURIComponent(before):''),owner,active);
 useEffect(()=>{setBefore('');setSelected(null);},[linkId,owner]);
 return <section className="dc-notes jn-list"><p className="dc-care-caption">Заметки доступны по разрешению пациента. Саммари пока формирует локальная тестовая заглушка.</p><ResourceMessage state={state}/>{state.data?.items.map(note=><article key={note.id}><button onClick={()=>setSelected({path:path+'/'+note.id+'?revision='+note.revision,linkId,owner})}><span><small>{note.day} · версия {note.revision}</small><strong>{note.title||'Без названия'}</strong><small>{journalStatus(note.analysis)}</small></span><CaretRight size={17}/></button>{note.analysis.result&&<p className="jn-summary">{note.analysis.result.summary}</p>}</article>)}{state.data&&!state.data.items.length&&<p>Доступных записей пока нет.</p>}<div className="jn-actions">{before&&<button className="text-button" onClick={()=>setBefore('')}>К последним записям</button>}{state.data?.nextBefore&&<button className="secondary-button" onClick={()=>setBefore(state.data.nextBefore)}>Ранее</button>}<button className="text-button" onClick={state.reload}><ArrowClockwise size={16}/>Обновить</button></div>{active&&selected&&selected.linkId===linkId&&selected.owner===owner&&<NoteDetail owner={owner} path={selected.path} onClose={()=>setSelected(null)}/>}</section>;
}
export function JournalAlerts({owner,active}){
 const state=useJournalResource('/api/care/alerts',owner,active&&Boolean(owner)),[open,setOpen]=useState(false),[selected,setSelected]=useState(null),[before,setBefore]=useState('');
 const page=useJournalResource(open?'/api/care/alerts'+(before?'?before='+before:''):null,owner,active&&Boolean(owner));
 useEffect(()=>{setOpen(false);setSelected(null);setBefore('');},[owner,active]);
 if(!owner)return null;
 return <><button className="dw-outline-button jn-alert-button" onClick={()=>setOpen(true)}><Bell size={18}/>Заметки{state.data?.unread>0&&<span aria-label="Не принятые уведомления">{state.data.unread}</span>}</button>{open&&<Modal title="Уведомления о заметках" onClose={()=>{setOpen(false);setSelected(null);}}><div className="modal-body jn-list"><p className="input-hint">Тестовые сигналы заглушки. Внешние уведомления не подключены.</p><ResourceMessage state={page}/>{page.data?.items.map(item=><article key={item.id}><button className="secondary-button" onClick={()=>setSelected({id:item.id,owner})}><Bell size={18}/>{item.kind==='processing'?'Нужен ручной просмотр':'Тестовый сигнал'} · {item.state==='acknowledged'?'принято':item.state==='seen'?'просмотрено':'новое'}<CaretRight size={17}/></button></article>)}{page.data&&!page.data.items.length&&<p>Уведомлений нет.</p>}{page.data?.nextBefore&&<button className="text-button" onClick={()=>setBefore(page.data.nextBefore)}>Ранее</button>}{before&&<button className="text-button" onClick={()=>setBefore('')}>К последним</button>}</div></Modal>}{active&&selected?.owner===owner&&<NoteDetail alert owner={owner} path={'/api/care/alerts/'+selected.id} onClose={()=>setSelected(null)} onChanged={()=>{page.reload();state.reload();}}/>}</>;
}
