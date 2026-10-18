import { useRef, useState } from 'react';
import { Pill, Check, CaretRight } from '@phosphor-icons/react';
import { Row } from './components.jsx';
import { doseLabel, mealLabel, upcomingMedicationReminders } from './medications.js';
import { usePersistentStorage } from './persistence.js';

export function HomeMedicationReminders({ entries, now, onOpen, onSave, onReload, onToast }) {
  const reminders = upcomingMedicationReminders(entries, now);
  const hasPlans = entries.some(entry => entry.type === 'medication-plan' && !entry.archived);
  const [pending, setPending] = useState([]);
  const inFlight = useRef(new Set());
  const storageReady = usePersistentStorage();
  const mark = async row => {
    if (inFlight.current.has(row.id)) return;
    inFlight.current.add(row.id); setPending(old => [...old, row.id]);
    try { await onSave({ id: row.id, type: 'medication-dose', planId: row.planId, day: row.day, time: row.time, status: 'taken', expectedRevision: row.eventRevision }); }
    catch (error) { onToast(error.message); if (error.status === 409) await onReload().catch(() => {}); }
    finally { inFlight.current.delete(row.id); setPending(old => old.filter(id => id !== row.id)); }
  };
  if (!reminders.length) return <Row icon={Pill} className="medication-reminder" title="Лекарства" subtitle={hasPlans ? 'На сегодня напоминаний больше нет' : 'Добавьте препарат из назначения'} onClick={onOpen}/>;
  return <section className="home-medication-reminders" aria-label="Напоминания о препаратах на сегодня"><div className="home-medication-heading"><span><Pill size={23}/>Лекарства</span><button className="text-button" onClick={onOpen}>План<CaretRight size={16}/></button></div>
    {reminders.slice(0, 3).map(row => <article key={row.id} className="home-medication-item"><button className="home-medication-copy" aria-label={`Открыть схему ${row.name}, сегодня в ${row.time}`} onClick={onOpen}><span className="home-medication-title"><strong>{row.name}</strong><time>{row.time}</time></span><span className="home-medication-dose">{doseLabel(row)}</span>{mealLabel(row.meal) && <span className="home-medication-meal">{mealLabel(row.meal)}</span>}</button><button className="home-medication-mark" disabled={!storageReady || pending.includes(row.id)} onClick={() => mark(row)} aria-label={`Отметить приём ${row.name} в ${row.time}`} title="Отметить приём"><Check size={18}/><span>{pending.includes(row.id) ? 'Сохраняем' : 'Принят'}</span></button></article>)}
    {reminders.length > 3 && <button className="text-button home-medication-more" onClick={onOpen}>Ещё приёмы: {reminders.length - 3}<CaretRight size={16}/></button>}
  </section>;
}
