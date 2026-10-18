import { useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { Modal } from './components.jsx';
import { DatePicker } from './DateTimeControls.jsx';
import { usePersistentStorage } from './persistence.js';
import { JOURNAL_LIMIT, makeJournalEntry } from './domain.js';

export function JournalEditor({ draft, onChange, onSave, onClose }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const persistent = usePersistentStorage();
  const change = patch => { onChange(old => ({ ...old, ...patch })); setError(''); };
  return <Modal title={draft.id ? 'Запись в дневнике' : 'Новая запись'} className="journal-modal" onClose={onClose}>
    <form className="journal-form" onSubmit={async event => {
      event.preventDefault();
      if (pending) return;
      setPending(true);
      try { await onSave(makeJournalEntry(draft)); } catch (err) { setError(err.message); }
      finally { setPending(false); }
    }}>
      <DatePicker label="Дата записи" disabled={pending} value={draft.date} onChange={date => change({ date })}/>
      <input className="journal-title-input" disabled={pending} aria-label="Название записи" placeholder="Название" maxLength={120} value={draft.title} onChange={event => change({ title: event.target.value })}/>
      <textarea className="journal-body-input" disabled={pending} aria-label="Текст записи" placeholder="О чём вы думаете? Что чувствуете? Здесь есть место для ваших мыслей." maxLength={JOURNAL_LIMIT} value={draft.body} onChange={event => change({ body: event.target.value })}/>
      {error && <p className="journal-error" role="alert">{error}</p>}
      <div className="journal-editor-footer"><span>{persistent ? 'Сохранение в локальную базу' : 'Хранилище недоступно'}</span><button type="submit" className="primary" disabled={pending}><Check size={18}/>{pending ? 'Сохраняем…' : 'Сохранить запись'}</button></div>
    </form>
  </Modal>;
}
