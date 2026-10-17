import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ArrowRight, NotePencil } from '@phosphor-icons/react';
import { Modal, Chips } from './components.jsx';
import { MOODS, FACTORS, makeMoodEntry, dayKey, dateLabel, validEntryDate } from './domain.js';
import { moodChromeAt } from './mood-motion.js';
import { MoodComposition } from './MoodComposition.jsx';

export function MoodFlow({ initialDate = dayKey(), initialEntry = null, onClose, onSave }) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState('idle');
  const transitionTimer = useRef(null);
  const moving = useRef(false);
  useEffect(() => () => clearTimeout(transitionTimer.current), []);
  const transitionStep = next => {
    if (moving.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setStep(next); return; }
    moving.current = true;
    setPhase('leaving');
    transitionTimer.current = setTimeout(() => {
      setStep(next);
      setPhase('entering');
      transitionTimer.current = setTimeout(() => { setPhase('idle'); moving.current = false; }, 300);
    }, 130);
  };
  const date = initialEntry?.day || (initialEntry ? dayKey(new Date(initialEntry.at)) : initialDate);
  const [kind, setKind] = useState(initialEntry?.kind || (date === dayKey() ? 'moment' : 'day'));
  const [tracking, setTracking] = useState(false);
  const [position, setPosition] = useState(initialEntry?.value ?? 3);
  const value = Math.round(position);
  const [words, setWords] = useState(initialEntry?.words || []);
  const [factors, setFactors] = useState(initialEntry?.factors || []);
  const [note, setNote] = useState(initialEntry?.note || '');
  const activePointer = useRef(null);
  const positionFromPointer = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = window.matchMedia('(max-width: 760px)').matches ? 18 : 20;
    const next = Math.round(Math.max(0, Math.min(6, (event.clientX - rect.left - radius) / (rect.width - radius * 2) * 6)) * 100) / 100;
    setPosition(next);
    if (Math.round(next) !== value) setWords([]);
  };
  const beginPointer = event => {
    event.preventDefault();
    activePointer.current = event.pointerId;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    setTracking(true);
    positionFromPointer(event);
  };
  const finishPointer = event => {
    if (activePointer.current !== event.pointerId) return;
    positionFromPointer(event);
    activePointer.current = null;
    setTracking(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const mood = MOODS[value];
  const next = () => { if (moving.current || !validEntryDate(date)) return; if (step === 2) { const entry = makeMoodEntry({ value, words, factors, note, kind, date }); onSave(initialEntry ? { ...entry, id: initialEntry.id, at: initialEntry.at, createdAt: initialEntry.createdAt || initialEntry.at, updatedAt: entry.createdAt } : entry); } transitionStep(step + 1); };
  const progress = step < 3 ? <div className="flow-progress" aria-label={`Шаг ${step + 1} из 3`}>{[0, 1, 2].map(i => <span key={i} className={i <= step ? 'filled' : ''}/>)}</div> : null;
  return <Modal title={step === 3 ? 'Отметка сохранена' : 'Ваше состояние'} onClose={onClose} style={moodChromeAt(position)} headerLead={progress} className={`mood-modal living-mood tone-${mood.tone} mood-level-${value} mood-step-${step} ${tracking ? 'tracking' : ''}`}>
    <MoodComposition position={position} tracking={tracking} step={step} label={`Маскот: ${mood.short.toLowerCase()}`}/>
    <div className={`flow-content flow-${phase}`} key={step} aria-busy={phase !== 'idle'}>
      {step === 0 && <>
        <h3>{date === dayKey() ? 'Как вы себя чувствуете?' : 'Как вы себя чувствовали?'}</h3>
        <div className="segmented kind-switch" data-kind={kind}><span className="kind-thumb" aria-hidden="true"/><button aria-pressed={kind === 'moment'} className={kind === 'moment' ? 'active' : ''} onClick={() => setKind('moment')}>{date === dayKey() ? 'Прямо сейчас' : 'В тот момент'}</button><button aria-pressed={kind === 'day'} className={kind === 'day' ? 'active' : ''} onClick={() => setKind('day')}>За весь день</button></div>
        <div className="scene-slot" aria-hidden="true"/>
        <div className="mood-name" aria-live="polite">{mood.name}</div>
        <div className="range-wrap"><input type="range" min="0" max="6" step="0.01" value={position} aria-label="Настроение" aria-valuetext={mood.name} onPointerDown={beginPointer} onPointerMove={e => { if (activePointer.current === e.pointerId) positionFromPointer(e); }} onPointerUp={finishPointer} onPointerCancel={() => { activePointer.current = null; setTracking(false); }} onLostPointerCapture={() => { activePointer.current = null; setTracking(false); }} onBlur={() => { activePointer.current = null; setTracking(false); }} onInput={e => { const next = Number(e.currentTarget.value); setPosition(next); if (Math.round(next) !== value) setWords([]); }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPosition(Math.max(0, Math.min(6, Math.round(position) + (e.key === 'ArrowRight' ? 1 : -1)))); setWords([]); } }} onChange={e => { const next = Number(e.target.value); setPosition(next); if (Math.round(next) !== value) setWords([]); }}/><div className="range-labels"><span>Очень неприятно</span><span>Очень приятно</span></div></div>
      </>}
      {step === 1 && <><div className="scene-slot compact" aria-hidden="true"/><h3>Что точнее описывает<br/>это чувство?</h3><p className="secondary centered">Можно выбрать несколько слов или пропустить</p><Chips items={mood.words} selected={words} onChange={setWords}/></>}
      {step === 2 && <><h3>Что повлияло на вас?</h3><p className="secondary centered">Добавьте контекст, если хочется</p><Chips items={FACTORS} selected={factors} onChange={setFactors}/>
        <div className="mood-note-card">
          <div className="note-card-heading"><NotePencil size={19}/><label htmlFor="mood-note">Личная заметка</label></div>
          <textarea id="mood-note" value={note} maxLength={1000} rows={3} placeholder={date === dayKey() ? 'Что было важным для вас сегодня?' : 'Что было важным для вас в этот день?'} onChange={e => setNote(e.target.value)}/>
        </div>
      </>}
      {step === 3 && <div className="success-view"><span className="success-icon"><Check size={28}/></span><h3>Спасибо, что заметили<br/>своё состояние</h3><p className="secondary centered">{mood.name}{words.length ? ` · ${words.join(', ').toLowerCase()}` : ''}</p><p className="secondary centered">Отметка за {dateLabel(`${date}T12:00:00+03:00`)} появилась в дневнике.</p></div>}
    </div>
    {step > 0 && step < 3 && date !== dayKey() && <p className="flow-date-caption">Запись за {dateLabel(`${date}T12:00:00+03:00`)}</p>}
    {!validEntryDate(date) && <p role="alert" className="date-error">Выберите существующую дату не позднее сегодняшней.</p>}
    <div className="flow-actions">{step > 0 && step < 3 && <button className="icon-button back" aria-label="Предыдущий шаг" onClick={() => transitionStep(step - 1)}><ArrowLeft size={22}/></button>}<button className="primary" disabled={!validEntryDate(date)} onClick={step === 3 ? onClose : next}>{step === 2 ? 'Сохранить отметку' : step === 3 ? 'Готово' : 'Продолжить'}{step < 2 && <ArrowRight size={19}/>}</button></div>
  </Modal>;
}
