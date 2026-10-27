import { useEffect,useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { MoodDayScale, moodScaleLabel } from './MoodDayScale.jsx';
import { MOODS, dateLabel, dayKey, latestMoodForDay } from './domain.js';
import { calendarPeriod, moveCalendar } from './calendar.js';
import { CalendarMotion } from './CalendarMotion.jsx';

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const dateFor = key => new Date(`${key}T12:00:00Z`);

export function DiaryCalendar({ entries, selected, onSelect, purpose='diary',onPeriodChange }) {
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(selected);
  const [direction, setDirection] = useState(0);
  useEffect(()=>{if(purpose==='appointments')setAnchor(selected);},[selected,purpose]);
  const { key, days, offset } = calendarPeriod(view, anchor);
  useEffect(()=>{onPeriodChange?.({from:days[0],to:days.at(-1)});},[days[0],days.at(-1),onPeriodChange]);
  const today = dayKey();
  const period = view === 'week' ? `${dateLabel(dateFor(days[0]))} – ${dateLabel(dateFor(days.at(-1)))}` : new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateFor(anchor));
  const changeView = next => {
    if (next === view) return;
    // Stay near the day being viewed instead of resetting to the current week.
    if (days.includes(selected)) setAnchor(selected);
    setDirection(0); setView(next);
  };
  const move = amount => { setDirection(amount); setAnchor(old => moveCalendar(view, old, amount)); };
  const selectedEntries = entries.filter(entry => (entry.day || dayKey(new Date(entry.at))) === selected);
  const mood = latestMoodForDay(entries, selected);
  return <section className={`surface calendar-surface ${purpose === 'diary' ? 'mood-calendar' : ''}`} aria-label={purpose==='appointments'?'Календарь приёмов':'Календарь самочувствия'}>
    <div className="calendar-toolbar">
      <div className="segmented calendar-view-switch" role="group" aria-label="Период календаря" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'ArrowRight' ? 'month' : 'week'; changeView(next);
        event.currentTarget.querySelectorAll('button')[next === 'week' ? 0 : 1].focus();
      }}><span className="calendar-view-glider" aria-hidden="true" style={{ transform: `translateX(${view === 'month' ? 100 : 0}%)` }}/>{['week', 'month'].map(mode => <button key={mode} className={view === mode ? 'active' : ''} aria-pressed={view === mode} onClick={() => changeView(mode)}>{mode === 'week' ? 'Неделя' : 'Месяц'}</button>)}</div>
      <div className="calendar-arrows"><button className="icon-button" aria-label="Предыдущий период" onClick={() => move(-1)}><CaretLeft size={18}/></button><button className="icon-button" aria-label="Следующий период" onClick={() => move(1)}><CaretRight size={18}/></button></div>
    </div>
    <CalendarMotion pageKey={key} direction={direction}>
      <p className="calendar-period" aria-live="polite" aria-atomic="true">{period}</p>
      <div className="calendar-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
      <div className={`calendar-grid ${view === 'month' ? 'month' : ''}`}>
        {Array.from({ length: offset }, (_, i) => <span key={`space-${i}`} aria-hidden="true"/>)}
        {days.map(key => {
          const moods = entries.filter(entry => entry.type === 'mood' && (entry.day || dayKey(new Date(entry.at))) === key).sort((a,b) => new Date(a.at) - new Date(b.at));
          const record = latestMoodForDay(entries, key), count = entries.filter(entry => (entry.day || dayKey(new Date(entry.at))) === key).length;
          return <button key={key} className={`calendar-day ${key === selected ? 'selected' : ''} ${key === today ? 'is-today' : ''}`} aria-label={`${dateLabel(dateFor(key))}${record ? `, отметок настроения: ${moods.length}; ${moodScaleLabel(moods)}` : count ? (purpose==='appointments'?`, приёмов и запросов: ${count}`:`, записей: ${count}`) : purpose==='appointments'?', нет приёмов':', нет записей'}`} aria-current={key === today ? 'date' : undefined} aria-pressed={key === selected} onClick={() => { setAnchor(key); onSelect(key); }}><span>{Number(key.slice(-2))}</span>{record ? <MoodDayScale records={moods}/> : <span className={`empty-day ${count ? 'has-records' : ''}`} aria-hidden="true">·</span>}</button>;
        })}
      </div>
    </CalendarMotion>
    {purpose === 'diary' && <p className="mood-calendar-hint">Цвета сверху вниз — отметки настроения от утра к вечеру. Каждая отметка добавляет свой цвет.</p>}<div className="calendar-summary"><strong>{purpose==='appointments'?'Приёмы':mood ? MOODS[mood.value].short : selectedEntries.length ? 'Самочувствие' : 'Нет записей'}</strong><span>{purpose==='appointments'?`Приёмов и запросов: ${selectedEntries.length}`:selectedEntries.length ? `Записей: ${selectedEntries.length}` : 'День ещё не заполнен'}</span></div>
  </section>;
}
