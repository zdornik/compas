import {useState} from 'react';
import {clinicalNotesRequest} from './persistence.js';
import {usePollingResource} from './usePollingResource.js';
import {dayKey,dateLabel} from './domain.js';
import {DatePicker} from './DateTimeControls.jsx';
import './tracking.css';
const kinds={anamnesis:'Анамнез',psychotherapy:'Прогресс психотерапии',consultation:'Комментарий к консультации'};
const methods={unspecified:'Не указан',cbt:'КПТ',gestalt:'Гештальт',other:'Другой подход'};
const fresh=()=>({id:crypto.randomUUID(),expectedRevision:0,kind:'anamnesis',method:'unspecified',title:'',body:'',day:dayKey()});
export function CareClinicalNotes({linkId,owner,active,draft,onChange}){
 const [before,setBefore]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 const params={limit:20,...(before?{before}:{})},path='/api/care/patients/'+linkId+'/clinical-notes?'+new URLSearchParams(params);
 const state=usePollingResource({role:'doctor',owner,path,active,load:signal=>clinicalNotesRequest(linkId,{params,signal})});
 const change=(name,value)=>{onChange({...draft,[name]:value});setError('');};
 return <section className="trk-clinical-notes"><header className="dw-record-toolbar"><div><h2>Заметки врача</h2><p>Анамнез и ход психотерапии · доступны только автору при активном подключении пациента.</p></div>{!draft&&<button className="dw-primary" onClick={()=>onChange(fresh())}>Добавить комментарий</button>}</header>
 {draft&&<form className="trk-note-editor" onSubmit={async event=>{event.preventDefault();if(pending)return;setPending(true);setError('');setConflict(false);try{await clinicalNotesRequest(linkId,{body:draft});onChange(null);setBefore(null);await state.reload();}catch(e){setError(e.message);setConflict(e.status===409);}finally{setPending(false);}}}>
 <fieldset disabled={pending}><div className="trk-filters"><label>Тип записи<select value={draft.kind} onChange={e=>change('kind',e.target.value)}>{Object.entries(kinds).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label><label>Подход<select value={draft.method} onChange={e=>change('method',e.target.value)}>{Object.entries(methods).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label><DatePicker label="Дата комментария" value={draft.day} onChange={value=>change('day',value)}/></div>
 <label className="med-field"><span>Заголовок</span><input maxLength={120} value={draft.title} onChange={e=>change('title',e.target.value)}/></label><label className="med-field"><span>Наблюдения и прогресс</span><textarea aria-label="Наблюдения и прогресс" required maxLength={20000} rows={7} value={draft.body} onChange={e=>change('body',e.target.value)}/></label>
 {error&&<p className="journal-error" role="alert">{error}</p>}{conflict&&<button type="button" className="text-button" onClick={()=>state.reload()}>Обновить список для сравнения, сохранив черновик</button>}<div className="cp-actions"><button className="dw-primary" disabled={!draft.body.trim()}>{pending?'Сохраняем…':'Сохранить комментарий'}</button><button type="button" className="text-button" onClick={()=>onChange(null)}>Закрыть черновик</button>{conflict&&<button type="button" className="text-button" onClick={()=>{onChange({...draft,id:crypto.randomUUID(),expectedRevision:0});setConflict(false);setError('');}}>Сохранить текст отдельным комментарием</button>}</div></fieldset></form>}
 {state.error&&<p className="journal-error" role="alert">{state.error}</p>}{state.loading&&<p role="status">Загружаем комментарии…</p>}
 {state.data?.items.map(note=><article className="trk-note" key={note.id}><small>{dateLabel(note.day+'T12:00:00Z')} · {kinds[note.kind]}{note.method!=='unspecified'?' · '+methods[note.method]:''} · версия {note.revision}</small><h3>{note.title||kinds[note.kind]}</h3><p>{note.body}</p><button className="text-button" disabled={Boolean(draft)} onClick={()=>{onChange({...note,expectedRevision:note.revision});setError('');}}>Редактировать комментарий</button></article>)}
 {state.data&&!state.data.items.length&&<p className="trk-help">Комментариев пока нет. Здесь можно фиксировать анамнез, обсуждённые темы и наблюдения между встречами.</p>}<div className="cp-actions">{before&&<button className="text-button" onClick={()=>setBefore(null)}>Последние комментарии</button>}{state.data?.nextCursor&&<button className="text-button" onClick={()=>setBefore(state.data.nextCursor)}>Более ранние</button>}</div>
 <p className="trk-help">КПТ и гештальт здесь — метки подхода. Структурированные методики, задания и оценка их эффективности запланированы отдельно.</p></section>;
}
