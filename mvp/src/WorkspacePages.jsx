import { useState } from 'react';
import { ChatCircle, NotePencil, MagnifyingGlass, ArrowUpRight, BookOpen, Pill, Plus, Check, ArrowCounterClockwise, Clock, Moon, ClipboardText, ShieldCheck, Bell, ChatsCircle, CalendarBlank, CaretRight } from '@phosphor-icons/react';
import { Row } from './components.jsx';
import { dayKey, dateLabel } from './domain.js';
import {Appointments} from './Appointments.jsx';

function Switch({ value, onChange }) {
  const options = [{ id: 'notes', label: 'Записи' }, { id: 'observations', label: 'Самочувствие' }];
  const active = options.findIndex(option => option.id === value);
  return <div className="workspace-switch" role="tablist" aria-label="Раздел дневника" onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); const next = active === 0 ? 1 : 0;
    onChange(options[next].id); event.currentTarget.querySelectorAll('button')[next].focus();
  }}><span className="switch-glider" style={{ transform: `translateX(${active * 100}%)` }} aria-hidden="true"/>{options.map(option => <button key={option.id} id={`tab-${option.id}`} role="tab" aria-selected={value === option.id} aria-controls={`diary-${option.id}`} tabIndex={value === option.id ? 0 : -1} onClick={() => onChange(option.id)}>{option.label}</button>)}</div>;
}

export function DiaryPage({ entries, selectedId, onSelect, onNew, onAdd, onEdit, hasDraft, children }) {
  const [view, setView] = useState('notes');
  const [query, setQuery] = useState('');
  const notes = entries.filter(entry => entry.type === 'journal').sort((a, b) => Number(Boolean(a.sample)) - Number(Boolean(b.sample)) || new Date(b.updatedAt || b.at) - new Date(a.updatedAt || a.at));
  const filtered = notes.filter(entry => `${entry.title}\n${entry.body}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
  const countWord = { one: 'запись', few: 'записи', many: 'записей', other: 'записи' }[new Intl.PluralRules('ru').select(notes.length)];
  const choose = entry => { onSelect(entry.id); onEdit(entry); };
  return <>
    <div className="workspace-intro"><p>Мысли, чувства и маленькие наблюдения.</p><div className="diary-add-actions"><button className="primary notebook-new" onClick={onNew}><NotePencil size={19}/>{hasDraft ? 'Продолжить запись' : 'Новая запись'}</button><button className="icon-button diary-add-button" aria-label="Добавить в дневник" onClick={() => onAdd(view === 'notes' ? dayKey() : undefined)}><Plus size={23}/></button></div></div>
    <Switch value={view} onChange={setView}/>
    {view === 'notes' ? <section id="diary-notes" role="tabpanel" aria-labelledby="tab-notes" className="notebook-panel">
      <div className="notebook-tools"><label className="note-search"><MagnifyingGlass size={19}/><input type="search" aria-label="Поиск по записям" placeholder="Найти в записях" value={query} onChange={event => setQuery(event.target.value)}/></label><span>{notes.length} {countWord}</span></div>
      {filtered.length ? <div className="notes-list" aria-label="Ваши записи">{filtered.map(entry => <button key={entry.id} className="notes-list-row" aria-label={`Открыть запись «${entry.title || 'Без названия'}»`} onClick={() => choose(entry)}><span className="notes-row-date"><strong>{new Date(entry.at).toLocaleDateString('ru-RU', { day: 'numeric', timeZone: 'Europe/Moscow' })}</strong><small>{new Date(entry.at).toLocaleDateString('ru-RU', { month: 'short', timeZone: 'Europe/Moscow' })}</small></span><span className="notes-row-copy"><span className="notes-row-heading"><strong>{entry.title || 'Без названия'}</strong>{entry.sample && <em>Пример</em>}</span><span className="notes-row-excerpt">{entry.body}</span><small>{entry.day === dayKey() ? 'Сегодня' : dateLabel(entry.at)} · {new Date(entry.at).getFullYear()}</small></span><CaretRight size={19}/></button>)}</div> : <div className="notebook-empty"><BookOpen size={30}/><h2>{query ? 'Ничего не нашлось' : 'Ваше место для мыслей'}</h2><p>{query ? 'Попробуйте другое слово.' : 'Можно начать с одного предложения и продолжить, когда захочется.'}</p><button className="secondary-button" onClick={query ? () => setQuery('') : onNew}>{query ? 'Сбросить поиск' : 'Создать первую запись'}</button></div>}
    </section> : <section id="diary-observations" role="tabpanel" aria-labelledby="tab-observations" className="observations-panel">{children}</section>}
  </>;
}

export function DoctorPage({ onOpen, onNavigate, children,owner,active,onRequestAuth }) {
  return <>{children}<section className="surface cp-patient-chat-entry"><span className="workspace-icon"><ChatCircle size={24}/></span><div><h2>Сообщения с врачом</h2><p>Переписка доступна после подтверждения подключения.</p></div><button className="secondary-button" onClick={()=>onOpen('chat')}>Открыть чат<ArrowUpRight size={17}/></button></section><div className="doctor-details-grid"><Appointments owner={owner} active={active} onRequestAuth={onRequestAuth}/><section className="visit-preparation"><div className="workspace-section-head"><h2>Перед приёмом</h2><BookOpen size={22}/></div><p>Проверьте медицинский профиль и отметьте мысли, которые хотите обсудить.</p><button className="text-button" onClick={() => onNavigate('diary')}>Открыть дневник<ArrowUpRight size={17}/></button></section></div><p className="workspace-footnote">Сообщения обновляются в открытом приложении. Фоновые уведомления пока не подключены.</p></>;
}
