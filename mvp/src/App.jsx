import { useEffect, useRef, useState } from 'react';
import { House, BookOpen, CalendarBlank, ChatsCircle, Pill, ClipboardText, Plus, Moon, Check, CaretLeft, CaretRight, ArrowUpRight, GearSix, ShieldCheck, DownloadSimple, ArrowCounterClockwise, LockSimple, Bell, CheckCircle } from '@phosphor-icons/react';
import { Modal, Row, Art } from './components.jsx';
import { MoodFlow } from './MoodFlow.jsx';
import { MoodScene } from './MoodScene.jsx';
import { MOODS, initialEntries, timeLabel, dateLabel, dayKey, changeDoseStatus, latestMoodForDay, entryTimestamp } from './domain.js';

const tabs = [{ id: 'today', name: 'Сегодня', icon: House }, { id: 'diary', name: 'Дневник', icon: BookOpen }, { id: 'treatment', name: 'Лечение', icon: CalendarBlank }, { id: 'doctor', name: 'Врач', icon: ChatsCircle }];
const initialDoses = [{ id: 'one', name: 'Препарат 1', status: 'planned' }, { id: 'two', name: 'Препарат 2', status: 'planned' }];

export function App() {
  const [page, setPage] = useState('today');
  const [diaryDay, setDiaryDay] = useState(dayKey);
  const [editingMood, setEditingMood] = useState(null);
  const [modal, setModal] = useState(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);
  const closeModal = () => {
    if (closeTimer.current) return;
    setClosing(true);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
    closeTimer.current = setTimeout(() => { setModal(null); setClosing(false); closeTimer.current = null; }, duration);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const [entries, setEntries] = useState(initialEntries);
  const [doses, setDoses] = useState(initialDoses);
  const [questionnaire, setQuestionnaire] = useState(false);
  const [toast, setToast] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const ready = e => { e.preventDefault(); setInstallPrompt(e); };
    const done = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', done); };
  }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); } }, [toast]);
  const latest = latestMoodForDay(entries);
  const mood = MOODS[latest?.value ?? 3];
  const completed = doses.filter(d => d.status !== 'planned').length;
  const navigate = p => { setPage(p); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const openMood = (entry = null) => { setEditingMood(entry); setModal('mood'); };
  const save = entry => { setEntries(old => old.some(e => e.id === entry.id) ? old.map(e => e.id === entry.id ? entry : e) : [entry, ...old]); if (page === 'diary') setDiaryDay(entry.day || dayKey(new Date(entry.at))); };
  return <div className={`app tone-${mood.tone} ${closing ? 'closing' : ''}`}>
    <a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <aside className="sidebar">
      <div className="wordmark">компас<span className="wordmark-dot"/></div><div className="sidebar-caption">Пространство заботы о себе</div>
      <nav aria-label="Основная навигация">{tabs.map(({ id, name, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={page === id ? 'current' : ''} aria-current={page === id ? 'page' : undefined}><Icon size={23} weight={page === id ? 'duotone' : 'regular'}/><span>{name}</span>{page === id && <span className="nav-indicator"/>}</button>)}</nav>
      <div className="sidebar-bottom"><button className="sidebar-setting" onClick={() => setModal('settings')}><GearSix size={21}/>Настройки и приватность</button><p><span className="demo-dot"/>Демонстрационная версия</p><small>Только вымышленные данные.<br/>Записи до обновления страницы.</small></div>
    </aside>
    <main tabIndex={-1} id="main-content" className={`main page-${page}`}>
      {page === 'today' ? <>
        <section className="home-hero">
          <MoodScene value={latest?.value ?? 3}/>
          <div className="hero-inner"><h1>Сегодня</h1><div className="hero-state"><h2>{mood.short}</h2><p>Последняя отметка<br/>{latest ? timeLabel(latest.at) : 'Пока нет отметки'}</p></div>
            <button className="mascot-target" aria-label="Оценить настроение, нажав на маскота" onClick={() => openMood()}/>
            <button className="mood-cta" onClick={() => openMood()}>Отметить настроение<Plus size={25}/></button>
          </div>
        </section>
        <section className="today-section content-width"><div className="section-heading"><h2>На сегодня</h2><span className="desktop-only quiet">В своём ритме</span></div><div className="reminder-group">
          <Row icon={completed === 2 ? CheckCircle : Pill} className="medication-reminder" title="Лекарства" subtitle={completed === 2 ? 'Демонстрационный журнал заполнен' : 'Вечерний приём · 2 препарата'} end={completed === 2 ? <Check size={22}/> : '22:00'} onClick={() => setModal('medication')}/>
          <Row icon={ClipboardText} title="Опросник самочувствия" subtitle={questionnaire ? 'Демоопрос пройден сегодня' : 'Демоопрос · 3 вопроса'} end={questionnaire ? <Check size={22}/> : '2 мин'} onClick={() => setModal('questionnaire')}/>
        </div><button className="mobile-info" onClick={() => setModal('settings')}>Демоверсия · о данных и приложении</button></section>
      </> : <div className="page-content content-width" key={page}>
        <header className="page-header"><div><p className="eyebrow desktop-only">ЛИЧНОЕ ПРОСТРАНСТВО</p><h1>{tabs.find(t => t.id === page).name}</h1></div>{page === 'diary' && <button className="icon-button light" aria-label="Добавить запись в дневник" disabled={diaryDay > dayKey()} onClick={() => setModal('add')}><Plus size={24}/></button>}</header>
        {page === 'diary' && <Diary entries={entries} selected={diaryDay} setSelected={setDiaryDay} onEdit={openMood} onAdd={() => setModal('add')}/>}
        {page === 'treatment' && <Treatment doses={doses} questionnaire={questionnaire} onOpen={setModal}/>}
        {page === 'doctor' && <Doctor onOpen={setModal}/>}
      </div>}
    </main>
    <nav className="bottom-nav" aria-label="Навигация по приложению">{tabs.map(({ id, name, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={page === id ? 'current' : ''} aria-current={page === id ? 'page' : undefined}><Icon size={24}/><span>{name}</span></button>)}</nav>
    {toast && <div role="status" className="toast"><CheckCircle size={20}/>{toast}</div>}
    {modal === 'mood' && <MoodFlow initialEntry={editingMood} initialDate={page === 'diary' ? diaryDay : dayKey()} onClose={() => closeModal()} onSave={save}/>}
    {modal === 'medication' && <Medication doses={doses} onChange={(id, status) => setDoses(items => changeDoseStatus(items, id, status))} onClose={() => closeModal()}/>}
    {modal === 'questionnaire' && <Questionnaire completed={questionnaire} onClose={() => closeModal()} onComplete={() => { setQuestionnaire(true); setToast('Демоопрос завершён'); }}/ >}
    {modal === 'sleep' && <Sleep initialDate={page === 'diary' ? diaryDay : dayKey()} onClose={() => closeModal()} onSave={entry => { save(entry); closeModal(); setToast('Сон отмечен в дневнике'); }}/ >}
    {modal === 'add' && <Modal title="Добавить запись" onClose={() => closeModal()}><div className="modal-body"><Row icon={Plus} title="Состояние" subtitle={`За ${dateLabel(`${diaryDay}T12:00:00+03:00`)}`} onClick={() => openMood()}/><Row icon={Moon} title="Сон" subtitle="Длительность и качество отдыха" onClick={() => setModal('sleep')}/></div></Modal>}
    {modal === 'settings' && <Settings installed={installed} installPrompt={installPrompt} onClose={() => closeModal()} onInstall={async () => { await installPrompt.prompt(); const result = await installPrompt.userChoice; setInstallPrompt(null); if (result.outcome === 'accepted') setInstalled(true); }}/ >}
    {['health', 'change-doctor', 'chat', 'appointment', 'recommendations'].includes(modal) && <Unavailable type={modal} onClose={() => closeModal()}/>}
  </div>;
}

function Diary({ entries, selected, setSelected, onAdd, onEdit }) {
  const [view, setView] = useState('week');
  const [offset, setOffset] = useState(0);
  const today = dayKey();
  const date = new Date(`${today}T12:00:00Z`);
  let days;
  let period;
  if (view === 'week') {
    const weekday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - weekday + offset * 7);
    days = Array.from({ length: 7 }, (_, i) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + i); return d; });
    period = `${dateLabel(days[0])} – ${dateLabel(days[6])}`;
  } else {
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + offset);
    const count = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    days = Array.from({ length: count }, (_, i) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), i + 1, 12)));
    period = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).format(date);
  }
  const filtered = entries.filter(e => dayKey(new Date(e.at)) === selected);
  return <><section className="surface calendar-surface"><div className="calendar-toolbar"><div className="segmented"><button className={view === 'week' ? 'active' : ''} onClick={() => { setView('week'); setOffset(0); }}>Неделя</button><button className={view === 'month' ? 'active' : ''} onClick={() => { setView('month'); setOffset(0); }}>Месяц</button></div><div className="calendar-arrows"><button className="icon-button" aria-label="Предыдущий период" onClick={() => setOffset(o => o - 1)}><CaretLeft size={18}/></button><button className="icon-button" aria-label="Следующий период" onClick={() => setOffset(o => o + 1)}><CaretRight size={18}/></button></div></div><p className="calendar-period">{period}</p><div className={`calendar-grid ${view === 'month' ? 'month' : ''}`}>
      {days.map((d, i) => { const key = dayKey(d); const record = entries.find(e => e.type === 'mood' && dayKey(new Date(e.at)) === key); return <button key={key} className={`calendar-day ${key === selected ? 'selected' : ''}`} style={view === 'month' && i === 0 ? { gridColumnStart: (d.getUTCDay() + 6) % 7 + 1 } : undefined} aria-label={`${dateLabel(d)}${record ? `, ${MOODS[record.value].short}` : ', нет отметок'}`} aria-pressed={key === selected} onClick={() => setSelected(key)}><small>{new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'Europe/Moscow' }).format(d)}</small><span>{d.getUTCDate()}</span>{record ? <Art tone={MOODS[record.value].tone} className="calendar-orb"/> : <span className="empty-day">·</span>}</button>; })}
    </div><div className="calendar-summary"><strong>{filtered.find(e => e.type === 'mood') ? MOODS[filtered.find(e => e.type === 'mood').value].short : 'Нет отметок'}</strong><span>{filtered.length ? `Записей: ${filtered.length}` : 'День ещё не заполнен'}</span></div></section>
    <div className="section-heading"><h2>{selected === today ? 'Сегодня' : dateLabel(`${selected}T12:00:00Z`)}</h2><button className="text-button" onClick={onAdd} disabled={selected > today}>Добавить <Plus size={17}/></button></div>
    <div className="timeline">{filtered.length ? filtered.map(entry => <article className="timeline-row" key={entry.id}><time>{entry.kind === 'day' ? 'За день' : timeLabel(entry.at)}</time><div className="timeline-dot"/><div className="entry surface"><div className="entry-title">{entry.type === 'mood' ? <><Art tone={MOODS[entry.value].tone} className="entry-orb"/><h3>{MOODS[entry.value].short}</h3></> : <><Moon size={23}/><h3>Сон · {entry.hours} ч {entry.minutes} мин</h3></>}{entry.sample && <span className="sample-label">пример</span>}</div>{entry.type === 'mood' && <small className="secondary">{entry.kind === 'day' ? 'Состояние за день' : 'Состояние в моменте'}</small>}{entry.note && <p className="entry-note">{entry.note}</p>}{entry.type === 'sleep' && <p className="secondary">Качество сна: {entry.quality.toLowerCase()}</p>}{entry.words?.length > 0 && <div className="entry-tags">{entry.words.map(word => <span key={word}>{word}</span>)}</div>}{entry.factors?.length > 0 && <p className="entry-factors">Повлияло: {entry.factors.join(', ').toLowerCase()}</p>}{entry.type === 'mood' && <button className="text-button edit-entry" onClick={() => onEdit(entry)}>Изменить отметку</button>}</div></article>) : <div className="empty-state"><BookOpen size={32}/><h3>Здесь будут ваши записи</h3><p>Выберите другой день или добавьте отметку.</p><button className="text-button" onClick={onAdd} disabled={selected > today}>Добавить запись <Plus size={17}/></button></div>}</div>
    <p className="page-footnote">Записи видны только в этой вкладке. Отправка врачу и сводки появятся после подключения защищённого сервера.</p>
  </>;
}

function Treatment({ doses, questionnaire, onOpen }) {
  return <><div className="notice"><span className="demo-dot"/>Демонстрационный план, не назначение врача</div><section className="surface treatment-summary"><div className="section-heading"><h2>Ближайший приём</h2><span className="pill-label">22:00</span></div><p className="secondary">Вечером · 2 препарата</p><div className="dose-preview">{doses.map(d => <div key={d.id}><Pill size={22}/><span>{d.name}</span><small>{d.status === 'taken' ? 'Отмечен приём' : d.status === 'skipped' ? 'Пропущен' : 'Запланирован'}</small></div>)}</div><button className="secondary-button" onClick={() => onOpen('medication')}>Посмотреть и отметить<CaretRight size={18}/></button></section>
    <div className="section-heading"><h2>Забота о себе</h2></div><section className="surface"><Row icon={ClipboardText} title="Опросник самочувствия" subtitle={questionnaire ? 'Демоопрос завершён' : 'Короткая отметка, без оценки и диагноза'} end="2 мин" onClick={() => onOpen('questionnaire')}/><Row icon={Moon} title="Отметить сон" subtitle="Длительность и самочувствие после сна" onClick={() => onOpen('sleep')}/></section>
    <div className="section-heading"><h2>Мои сведения</h2></div><section className="surface"><Row icon={ShieldCheck} title="Препараты и заболевания" subtitle="Подключим вместе с медицинским профилем" onClick={() => onOpen('health')}/><Row icon={Bell} title="Напоминания" subtitle="Установка приложения и уведомления" onClick={() => onOpen('settings')}/></section><p className="page-footnote">Титрацию, дозировки и периодичность опросников в рабочей версии задаёт врач. Автоматической проверки совместимости пока нет.</p></>;
}

function Doctor({ onOpen }) {
  return <><section className="surface doctor-profile"><img src="/art/physician.png" alt="Демонстрационный портрет врача"/><span className="pill-label">Демо-профиль</span><h2>Анна Сергеевна</h2><p className="secondary">Ваш лечащий врач</p><button className="text-button" onClick={() => onOpen('change-doctor')}>Сменить специалиста<ArrowUpRight size={17}/></button></section><div className="section-heading"><h2>На связи</h2></div><section className="surface"><Row icon={ChatsCircle} title="Написать врачу" subtitle="Переписка ещё не подключена" onClick={() => onOpen('chat')}/><Row icon={CalendarBlank} title="Следующий приём" subtitle="Календарь подключим на следующем этапе" onClick={() => onOpen('appointment')}/><Row icon={ClipboardText} title="Рекомендации врача" subtitle="Здесь будут сообщения после ваших отметок" onClick={() => onOpen('recommendations')}/></section><p className="page-footnote">В этом прототипе сообщения не отправляются. Канал связи с врачом не предназначен для экстренных обращений.</p></>;
}

function Medication({ doses, onChange, onClose }) {
  return <Modal title="Вечерний приём" onClose={onClose}><div className="modal-body"><div className="detail-topline"><span className="pill-label">Сегодня · 22:00</span><span className="secondary">Демо-план</span></div><p className="secondary">Вымышленные препараты для проверки интерфейса. Реальные назначения здесь пока не хранятся.</p><div className="dose-list">{doses.map(dose => <section key={dose.id} className="dose-item"><div className="dose-title"><Pill size={24}/><h3>{dose.name}</h3>{dose.status !== 'planned' && <span className="pill-label">{dose.status === 'taken' ? 'Принят' : 'Пропущен'}</span>}</div>{dose.status === 'planned' ? <div className="dose-actions"><button className="primary" onClick={() => onChange(dose.id, 'taken')}><Check size={18}/>Принят</button><button className="secondary-button" onClick={() => onChange(dose.id, 'skipped')}>Пропущен</button></div> : <button className="text-button" onClick={() => onChange(dose.id, 'planned')}><ArrowCounterClockwise size={17}/>Исправить отметку</button>}</section>)}</div><p className="input-hint">Отметки меняют только демонстрационный журнал, а не схему лечения.</p><button className="primary full-width" onClick={onClose}>Готово</button></div></Modal>;
}

function Sleep({ initialDate, onClose, onSave }) {
  const [sleepDate, setSleepDate] = useState(initialDate);
  const [hours, setHours] = useState('7'); const [minutes, setMinutes] = useState('0'); const [quality, setQuality] = useState('Хорошо');
  return <Modal title="Как вы спали?" onClose={onClose}><form className="modal-body" onSubmit={e => { e.preventDefault(); onSave({ id: crypto.randomUUID(), type: 'sleep', hours, minutes, quality, day: sleepDate, at: entryTimestamp(sleepDate), createdAt: new Date().toISOString() }); }}><p className="secondary">Отметьте длительность и качество последнего сна.</p><label className="entry-date-field">Дата сна<input type="date" required max={dayKey()} value={sleepDate} onChange={e => setSleepDate(e.target.value)}/></label><div className="duration-fields"><label>Часы<input required type="number" min="0" max="24" value={hours} onChange={e => setHours(e.target.value)}/></label><label>Минуты<input required type="number" min="0" max={Number(hours) === 24 ? 0 : 59} value={minutes} onChange={e => setMinutes(e.target.value)}/></label></div><label className="field-label" htmlFor="sleep-quality">Как вы выспались?</label><select id="sleep-quality" value={quality} onChange={e => setQuality(e.target.value)}>{['Плохо', 'Не очень', 'Нормально', 'Хорошо', 'Отлично'].map(q => <option key={q}>{q}</option>)}</select><p className="input-hint">Apple Health не подключён. Запись доступна до обновления страницы.</p><button className="primary full-width" type="submit">Сохранить</button></form></Modal>;
}

function Questionnaire({ completed, onComplete, onClose }) {
  const [answers, setAnswers] = useState({}); const [done, setDone] = useState(completed);
  const questions = ['Хватало ли вам сил сегодня?', 'Получилось ли отдохнуть?', 'Удалось ли сделать что-то приятное для себя?'];
  return <Modal title="Опросник самочувствия" onClose={onClose}><div className="modal-body">{done ? <div className="success-view"><span className="success-icon"><Check size={28}/></span><h3>На сегодня всё</h3><p className="secondary">Демонстрационный опрос завершён. Клинический результат не рассчитывается.</p><button className="primary full-width" onClick={onClose}>Готово</button></div> : <form onSubmit={e => { e.preventDefault(); setDone(true); onComplete(); }}><p className="secondary">Три вопроса для знакомства с интерфейсом. Это не шкала Бека и не диагностический тест.</p>{questions.map((q, i) => <fieldset className="question" key={q}><legend>{i + 1}. {q}</legend><div className="question-options">{['Нет', 'Частично', 'Да'].map(a => <label key={a}><input type="radio" name={`q${i}`} required checked={answers[i] === a} onChange={() => setAnswers(old => ({ ...old, [i]: a }))}/><span>{a}</span></label>)}</div></fieldset>)}<p className="input-hint">Ответы не отправляются и не сохраняются после закрытия опроса.</p><button className="primary full-width" type="submit">Завершить</button></form>}</div></Modal>;
}

function Settings({ installed, installPrompt, onInstall, onClose }) {
  return <Modal title="О приложении и данных" onClose={onClose}><div className="modal-body settings-body"><div className="settings-intro"><LockSimple size={27}/><h3>Личное остаётся личным</h3></div><p className="secondary">Это интерактивная демоверсия. Пожалуйста, используйте только вымышленные сведения.</p><section><h3>Где находятся записи</h3><p>Только в памяти этой вкладки. Обновление страницы удалит добавленные отметки. Сервер, аналитика и внешние шрифты не подключены.</p></section><section><h3>Добавить на главный экран</h3>{installed || window.matchMedia('(display-mode: standalone)').matches ? <p>Приложение установлено или уже открыто отдельно.</p> : <><p>На iPhone откройте сайт в Safari, нажмите «Поделиться», затем «На экран Домой». На компьютере и Android используйте установку в меню браузера.</p>{installPrompt && <button className="secondary-button" onClick={onInstall}><DownloadSimple size={20}/>Установить приложение</button>}</>}</section><section><h3>Уведомления</h3><p>Фоновые напоминания пока не подключены. В рабочей версии они будут приходить без названий лекарств и медицинских подробностей на экране блокировки.</p></section><button className="primary full-width" onClick={onClose}>Понятно</button></div></Modal>;
}

function Unavailable({ type, onClose }) {
  const content = {
    health: ['Медицинский профиль', 'Препараты, хронические заболевания и аллергии появятся после подключения защищённого профиля пациента. Проверка взаимодействий потребует проверенной лекарственной базы и участия врача.'],
    'change-doctor': ['Смена специалиста', 'Переход к другому врачу будет оформляться с вашим согласием на доступ к данным. Новый доступ и отзыв прежнего должны проверяться на сервере. В демоверсии врач не меняется.'],
    chat: ['Переписка с врачом', 'Защищённый чат пока не подключён. Здесь нельзя отправить сообщение. На следующем этапе добавим переписку, статусы доставки и понятные часы ответа.'],
    appointment: ['Запись на приём', 'Календарь ещё не подключён. Здесь появятся согласованное время приёма и возможность открыть его подробности.'],
    recommendations: ['Рекомендации врача', 'Здесь появится обратная связь вашего врача. Автоматические медицинские рекомендации в прототипе не генерируются.'],
  };
  return <Modal title={content[type][0]} onClose={onClose}><div className="modal-body"><p className="pill-label inline">Следующий этап</p><p className="secondary readable">{content[type][1]}</p><button className="primary full-width" onClick={onClose}>Понятно</button></div></Modal>;
}
