import { useRef, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { Modal } from './components.jsx';
import { DatePicker } from './DateTimeControls.jsx';
import { usePersistentStorage } from './persistence.js';
import { JOURNAL_LIMIT, makeJournalEntry } from './domain.js';

export function JournalEditor({ draft, onChange, onSave, onClose, onReload }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [conflict,setConflict]=useState(false),[copy,setCopy]=useState('');
  const attempt=useRef(null);
  const persistent = usePersistentStorage();
  const change = patch => { onChange(old => ({ ...old, ...patch })); setError('');setConflict(false);attempt.current=null; };
  return <Modal title={draft.id ? 'Запись в дневнике' : 'Новая запись'} className="journal-modal" onClose={onClose}>
    <form className="journal-form" onSubmit={async event => {
      event.preventDefault();
      if (pending) return;
      setPending(true);
      try {
        const entry=makeJournalEntry(draft),expectedRevision=draft.revision||0;
        const fingerprint=JSON.stringify({id:entry.id,title:entry.title,body:entry.body,day:entry.day,expectedRevision});
        if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,input:{...entry,expectedRevision,mutationId:crypto.randomUUID()}};
        await onSave(attempt.current.input);
      } catch (err) { setError(err.message);setConflict(err.status===409); }
      finally { setPending(false); }
    }}>
      <DatePicker label="Дата записи" disabled={pending} value={draft.date} onChange={date => change({ date })}/>
      <input className="journal-title-input" disabled={pending} aria-label="Название записи" placeholder="Название" maxLength={120} value={draft.title} onChange={event => change({ title: event.target.value })}/>
      <textarea className="journal-body-input" disabled={pending} aria-label="Текст записи" placeholder="О чём вы думаете? Что чувствуете? Здесь есть место для ваших мыслей." maxLength={JOURNAL_LIMIT} value={draft.body} onChange={event => change({ body: event.target.value })}/>
      {error && <p className="journal-error" role="alert">{error}</p>}
      {conflict&&onReload&&<button type="button" className="text-button" onClick={async()=>{setCopy(draft.title+"\n\n"+draft.body);try{await onReload();attempt.current=null;setConflict(false);setError('Актуальная версия загружена. Предыдущий черновик сохранён ниже.');}catch(error){setError(error.message);}}}>Загрузить актуальную версию</button>}{copy&&<details><summary>Предыдущий черновик</summary><textarea className="jn-conflict-copy" readOnly value={copy}/></details>}
      <div className="journal-editor-footer">{!persistent && <span role="status">Хранилище недоступно</span>}<button type="submit" className="primary" disabled={pending}><Check size={18}/>{pending ? 'Сохраняем…' : 'Сохранить запись'}</button></div>
    </form>
  </Modal>;
}
