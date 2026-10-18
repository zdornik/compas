import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CalendarBlank, CaretDown, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { dayKey } from './domain.js';
import { CalendarMotion } from './CalendarMotion.jsx';

const dateFromKey = key => new Date(`${key}T12:00:00Z`);
const keyFromDate = date => date.toISOString().slice(0, 10);
const fullDate = key => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateFromKey(key));
const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 1))));

export function DatePicker({ value, onChange, label = 'Дата', max = dayKey(), disabled = false }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => value.slice(0, 7));
  const [choosingMonth, setChoosingMonth] = useState(false);
  const [direction, setDirection] = useState(0);
  const root = useRef(null), trigger = useRef(null);
  const id = useId();
  const first = dateFromKey(`${month}-01`);
  const year = first.getUTCFullYear(), monthNumber = first.getUTCMonth();
  const count = new Date(Date.UTC(year, monthNumber + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const move = amount => { setDirection(Math.sign(amount)); setMonth(keyFromDate(new Date(Date.UTC(year, monthNumber + amount, 1))).slice(0, 7)); };
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = key => { onChange(key); close(); };
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useLayoutEffect(() => {
    if (open) root.current?.querySelector(`.calendar-motion-current [data-date="${value}"]`)?.focus();
  }, [open]);
  const navigateDate = event => {
    const current = event.target.dataset.date;
    if (!current) return;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: -1, PageDown: 1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = dateFromKey(current);
    if (event.key.startsWith('Page')) next.setUTCMonth(next.getUTCMonth() + delta);
    else next.setUTCDate(next.getUTCDate() + delta);
    const key = keyFromDate(next);
    if (key > max) return;
    setDirection(Math.sign(key.localeCompare(current)));
    setMonth(key.slice(0, 7));
    requestAnimationFrame(() => root.current?.querySelector(`.calendar-motion-current [data-date="${key}"]`)?.focus());
  };
  return <div className="date-control" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <span className="date-control-label">{label}</span>
    <button type="button" disabled={disabled} ref={trigger} className="date-trigger" aria-label={`${label}: ${fullDate(value)}`} aria-expanded={open} aria-controls={id} onClick={() => { setMonth(value.slice(0, 7)); setChoosingMonth(false); setOpen(!open); }}><CalendarBlank size={17}/><span>{fullDate(value)}</span><CaretDown size={14}/></button>
    {open && <div id={id} className="date-popover" role="dialog" aria-label={`Выбрать: ${label}`}>
      <div className="date-month-header"><button type="button" className="icon-button" aria-label={choosingMonth ? 'Предыдущий год' : 'Предыдущий месяц'} onClick={() => move(choosingMonth ? -12 : -1)}><CaretLeft size={18}/></button><button type="button" className="date-month-title" aria-label="Выбрать месяц и год" onClick={() => { setDirection(0); setChoosingMonth(!choosingMonth); }}>{choosingMonth ? year : `${months[monthNumber]} ${year}`}<CaretDown size={12}/></button><button type="button" className="icon-button" aria-label={choosingMonth ? 'Следующий год' : 'Следующий месяц'} disabled={choosingMonth ? year >= Number(max.slice(0, 4)) : month >= max.slice(0, 7)} onClick={() => move(choosingMonth ? 12 : 1)}><CaretRight size={18}/></button></div>
      <CalendarMotion pageKey={choosingMonth ? `year:${year}` : month} direction={direction}>{choosingMonth ? <div className="date-months">{months.map((name, index) => <button type="button" key={name} disabled={`${year}-${String(index + 1).padStart(2, '0')}` > max.slice(0, 7)} className={index === monthNumber ? 'selected' : ''} onClick={() => { setDirection(0); setMonth(`${year}-${String(index + 1).padStart(2, '0')}`); setChoosingMonth(false); }}>{name}</button>)}</div> : <>
        <div className="date-weekdays" aria-hidden="true">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="date-days" onKeyDown={navigateDate}>{Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`}/>)}{Array.from({ length: count }, (_, i) => {
          const key = `${month}-${String(i + 1).padStart(2, '0')}`;
          return <button type="button" key={key} data-date={key} aria-label={fullDate(key)} aria-pressed={key === value} aria-current={key === dayKey() ? 'date' : undefined} className={`${key === value ? 'selected' : ''} ${key === dayKey() ? 'is-today' : ''}`} disabled={key > max} onClick={() => choose(key)}>{i + 1}</button>;
        })}</div>
      </>}</CalendarMotion>
      <div className="date-shortcuts"><button type="button" onClick={() => { const yesterday = dateFromKey(max < dayKey() ? max : dayKey()); yesterday.setUTCDate(yesterday.getUTCDate() - 1); choose(keyFromDate(yesterday)); }}>Вчера</button><button type="button" onClick={() => choose(max < dayKey() ? max : dayKey())}>Сегодня</button></div>
    </div>}
  </div>;
}

const WHEEL_ROW = 44;
function Wheel({ label, value, max, onChange, unit }) {
  const ref = useRef(null);
  const [position, setPosition] = useState(value);
  const valueRef = useRef(value);
  const ready = useRef(false);
  valueRef.current = value;
  useLayoutEffect(() => {
    const element = ref.current;
    const initialise = () => {
      // A native dialog has no layout until showModal() in its parent.
      if (!element.clientHeight || ready.current) return;
      element.scrollTop = valueRef.current * WHEEL_ROW;
      setPosition(valueRef.current);
      ready.current = true;
    };
    const observer = new ResizeObserver(initialise);
    observer.observe(element); initialise();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = ref.current;
    // Updates emitted by a native scroll already have the correct position.
    // Only external changes (initial value, a new maximum) need synchronising.
    if (element && ready.current && Math.round(element.scrollTop / WHEEL_ROW) !== value) {
      element.scrollTop = value * WHEEL_ROW;
      setPosition(value);
    }
  }, [value, max]);
  const goTo = next => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current.scrollTo({ top: Math.max(0, Math.min(max, next)) * WHEEL_ROW, behavior: reduced ? 'instant' : 'smooth' });
  };
  return <div className="wheel-column"><span className="wheel-heading" aria-hidden="true">{unit}</span><div className="time-wheel" ref={ref} role="spinbutton" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} ${unit === 'Часы' ? 'ч' : 'мин'}`} onScroll={event => {
    if (!ready.current) return;
    const nextPosition = event.currentTarget.scrollTop / WHEEL_ROW;
    const next = Math.max(0, Math.min(max, Math.round(nextPosition)));
    setPosition(nextPosition);
    if (next !== valueRef.current) onChange(next);
  }} onKeyDown={event => {
    const delta = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[event.key];
    if (delta || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      goTo(event.key === 'Home' ? 0 : event.key === 'End' ? max : value + delta);
    }
  }}><div className="wheel-values" aria-hidden="true">{Array.from({ length: max + 1 }, (_, number) => {
    const distance = Math.max(-3, Math.min(3, number - position));
    const proximity = Math.max(0, 1 - Math.abs(distance));
    return <div key={number} className="wheel-number" style={{ opacity: Math.max(.12, 1 - Math.abs(distance) * .29), transform: `perspective(180px) rotateX(${-distance * 16}deg) scale(${.8 + proximity * .2})`, color: Math.abs(distance) < .5 ? 'var(--ui-accent)' : 'var(--ui-faint)' }} onClick={() => goTo(number)}>{String(number).padStart(2, '0')}</div>;
  })}</div></div></div>;
}

export function DurationWheel({ hours, minutes, onChange }) {
  return <div className="duration-picker"><div className="duration-picker-caption">Длительность сна</div><div className="duration-wheel-card"><div className="duration-wheels"><div className="wheel-selection" aria-hidden="true"/><Wheel label="Часы сна" unit="Часы" value={hours} max={24} onChange={value => onChange(value, value === 24 ? 0 : minutes)}/><span className="wheel-colon" aria-hidden="true">:</span><Wheel label="Минуты сна" unit="Минуты" value={minutes} max={hours === 24 ? 0 : 59} onChange={value => onChange(hours, value)}/></div></div><p className="wheel-hint">Прокрутите, чтобы выбрать время</p></div>;
}

export function TimeWheel({ value, onChange }) {
  const [hours, minutes] = value.split(':').map(Number);
  const update = (hour, minute) => onChange(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  return <div className="medication-time-wheel"><div className="duration-wheel-card"><div className="duration-wheels"><div className="wheel-selection" aria-hidden="true"/><Wheel label="Часы приёма" unit="Часы" value={hours} max={23} onChange={hour => update(hour, minutes)}/><span className="wheel-colon" aria-hidden="true">:</span><Wheel label="Минуты приёма" unit="Минуты" value={minutes} max={59} onChange={minute => update(hours, minute)}/></div></div></div>;
}
