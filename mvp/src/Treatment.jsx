import {useEntryHistory,HistoryStatus} from './useEntryHistory.jsx';
import {mergeEntries} from './history-data.js';
import {applyProductSelection} from './product-dose.js';
import {ProductPicker} from './MedicalProfile.jsx';
import {currentMedicationRows} from './current-medications.js';
import { useEffect, useRef, useState } from 'react';
import { Plus, Pill, Clock, Check, CaretRight, ArrowCounterClockwise, ClipboardText, Moon, ShieldCheck, Bell, PencilSimple, CalendarBlank, Archive, ArrowUpRight } from '@phosphor-icons/react';
import { Modal, Row } from './components.jsx';
import { ContourCanvas } from './ContourCanvas.jsx';
import { DatePicker } from './DateTimeControls.jsx';
import { MedicationEditor } from './MedicationEditor.jsx';
import { usePersistentStorage } from './persistence.js';
import { dayKey, dateLabel, timeLabel } from './domain.js';
import { addDays, doseLabel, formatAmount, medicationDraft, medicationSchedule, normalizeMedicationConfig, planForDay, stageForDay, mealLabel } from './medications.js';

const labelDate = day => dateLabel(`${day}T12:00:00Z`);

function PlanDetails({ plan, onEdit, onArchive, onCopy, pending, error }) {
  const stage = stageForDay(planForDay(plan, dayKey()), dayKey());
  let start = plan.startDate;
  return <><div className="medication-sheet-scroll medication-details">
    <div className="med-detail-heading"><span className="workspace-icon"><Pill size={27}/></span><div><span className="section-kicker">{plan.archived ? 'СХЕМА ЗАВЕРШЕНА' : 'ВАША СХЕМА'}</span><h3>{plan.name}</h3><p>{plan.form === 'capsule' ? 'Капсулы' : 'Таблетки'} · {plan.titration.enabled ? 'Титрация' : `${formatAmount(plan.strength)} ${plan.unit}`}</p></div></div>
    <dl className="med-plan-facts"><div><dt>Период</dt><dd>С {labelDate(plan.startDate)}{plan.endDate ? ` по ${labelDate(plan.endDate)}` : plan.titration.enabled && plan.titration.after === 'finish' ? ` по ${labelDate(addDays(plan.startDate, plan.titration.stages.reduce((sum, stage) => sum + stage.days, 0) - 1))}` : ' · без даты окончания'}</dd></div><div><dt>Ежедневно</dt><dd>{plan.times.join(' · ')}<small>Время Москвы</small></dd></div>{!plan.titration.enabled && <div><dt>Один приём</dt><dd>{doseLabel(plan)}</dd></div>}{mealLabel(plan.meal) && <div><dt>Приём пищи</dt><dd>{mealLabel(plan.meal)}</dd></div>}</dl>
    {plan.titration.enabled && <section className="med-timeline-section"><div className="med-detail-section-heading"><h4>Этапы титрации</h4><span>{plan.titration.stages.length}</span></div><ol className="med-plan-timeline">{plan.titration.stages.map((item, index) => {
      const from = start, to = addDays(start, item.days - 1); start = addDays(to, 1);
      const active = !plan.archived && stage?.index === index && !stage.maintenance;
      return <li key={index} className={active ? 'current' : ''}><span className="med-phase-dot">{index + 1}</span><div><span className="med-phase-date">{labelDate(from)} — {labelDate(to)}</span><strong>{doseLabel({ ...plan, ...item })}</strong><small>{formatAmount(item.strength)} {plan.unit} в {plan.form === 'capsule' ? 'капсуле' : 'таблетке'}{active ? ' · текущий этап' : ''}</small></div></li>;
    })}</ol><div className="med-after-summary"><CalendarBlank size={18}/><p>{plan.titration.after === 'maintain' ? 'Затем — та же дозировка, что на последнем этапе.' : 'После последнего этапа схема завершается.'}</p></div></section>}
    {plan.instructions && <section className="med-plan-instructions"><h4>Указания к приёму</h4><p>{plan.instructions}</p></section>}
    <p className="med-detail-caption">{plan.origin==='doctor'?`Назначил ${plan.prescriberName}. Получено ${new Date(plan.delivery.at).toLocaleString('ru-RU')}. `:''}Схема внесена вручную по назначению. Приложение не подбирает дозировки и не изменяет их по отметкам приёма.</p>
    {!plan.archived && <button className="text-button med-archive-action" disabled={pending} onClick={onArchive}><Archive size={17}/>Завершить схему</button>}
  </div><footer className="medication-sheet-footer">{error && <p className="journal-error" role="alert">{error}</p>}{plan.origin!=='doctor'&&<button className="primary full-width" disabled={pending} onClick={plan.archived ? onCopy : onEdit}>{plan.archived ? <><Plus size={19}/>Новая схема на основе этой</> : <><PencilSimple size={18}/>Изменить схему</>}</button>}<p className="med-save-caption">{plan.origin==='doctor'?'Для изменения назначения обратитесь к врачу. ':''}{plan.archived ? 'История приёмов сохранена.' : 'Уже отмеченные приёмы сохранят свою дозировку.'}</p></footer></>;
}

export function TreatmentPage({ entries:localEntries, active=true, onSave, onOpen, onReload, onToast, themeValue = 3, now }) {
  const today = dayKey(now);
  const [selectedDay, setSelectedDay] = useState(today);
  const history=useEntryHistory({kind:'doses',from:selectedDay,to:selectedDay,active});
  const entries=mergeEntries(history.entries,localEntries);
  const previousToday = useRef(today);
  useEffect(() => {
    if (today !== previousToday.current) {
      setSelectedDay(day => day === previousToday.current ? today : day);
      previousToday.current = today;
    }
  }, [today]);
  const [editor, setEditor] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null), busyDose = useRef(new Set());
  const [pendingDoses, setPendingDoses] = useState([]);
  const storageReady = usePersistentStorage();
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const plans = entries.filter(entry => entry.type === 'medication-plan').sort((a, b) => a.name.localeCompare(b.name));
  const medicationRows=currentMedicationRows(entries,undefined,today);
  const current = plans.filter(plan => medicationRows.some(row=>row.planId===plan.id)), archived = plans.filter(plan => !current.includes(plan));
  const selectedPlan = plans.find(plan => plan.id === editor?.planId);
  const rows = medicationSchedule(entries, selectedDay);
  const completed = rows.filter(row => row.status !== 'planned').length;
  const close = () => {
    if (pending || closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => { setEditor(null); setClosing(false); setError(''); setConflict(false); setArchiveConfirm(false); closeTimer.current = null; }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
  };
  const openDetails = plan => { setError(''); setConflict(false); setArchiveConfirm(false); setEditor({ key: plan.id, planId: plan.id, mode: 'details' }); };
  const openNew = source => {
    setError(''); setConflict(false); setArchiveConfirm(false);
    if (source) {
      const draft = { ...medicationDraft(source), id: crypto.randomUUID(), expectedRevision: 0, archived: false, startDate: today, endDate: null };
      setDrafts(old => ({ ...old, [draft.id]: draft })); setEditor({ key: draft.id, planId: null, mode: 'edit' });
    } else {
      setDrafts(old => old.new ? old : { ...old, new: medicationDraft() }); setEditor({ key: 'new', planId: null, mode: 'edit' });
    }
  };
  const edit = () => { setDrafts(old => old[selectedPlan.id] ? old : { ...old, [selectedPlan.id]: medicationDraft(selectedPlan) }); setEditor(old => ({ ...old, mode: 'edit' })); setArchiveConfirm(false); };
  const saveDraft = async () => {
    if (pending) return;
    setError(''); setConflict(false); setPending(true);
    try {
      const draft = drafts[editor.key], config = normalizeMedicationConfig(draft);
      const saved = await onSave({ id: draft.id, type: 'medication-plan', expectedRevision: draft.expectedRevision, ...config });
      setDrafts(old => { const next = { ...old }; delete next[editor.key]; return next; });
      setEditor({ key: saved.id, planId: saved.id, mode: 'details' }); onToast('Схема приёма сохранена');
    } catch (error) { setError(error.message); setConflict(error.status === 409); }
    finally { setPending(false); }
  };
  const reloadDraft = async () => {
    setPending(true);
    try {
      const state = await onReload(), plan = state.entries.find(entry => entry.id === editor.planId);
      if (!plan) throw new Error('Схема не найдена');
      setDrafts(old => ({ ...old, [editor.key]: medicationDraft(plan) })); setError(''); setConflict(false);
    } catch (error) { setError(error.message); } finally { setPending(false); }
  };
  const archive = async () => {
    if (!archiveConfirm) { setArchiveConfirm(true); return; }
    if (pending) return;
    setPending(true); setError('');
    try { const draft = medicationDraft(selectedPlan); await onSave({ ...draft, type: 'medication-plan', archived: true }); setArchiveConfirm(false); onToast('Схема завершена. История сохранена'); }
    catch (error) { setError(error.message); } finally { setPending(false); }
  };
  const mark = async (row, status) => {
    if (busyDose.current.has(row.id)) return;
    busyDose.current.add(row.id); setPendingDoses(old => [...old, row.id]);
    try { await onSave({ id: row.id, type: 'medication-dose', planId: row.planId, day: row.day, time: row.time, status, expectedRevision: row.eventRevision }); }
    catch (error) { onToast(error.message); if (error.status === 409) await onReload().catch(() => {}); }
    finally { busyDose.current.delete(row.id); setPendingDoses(old => old.filter(id => id !== row.id)); }
  };
  const planCard = plan => {
    const stage = stageForDay(planForDay(plan, today), today);
    return <button className="med-plan-card" key={plan.id} onClick={() => openDetails(plan)}><span className="workspace-icon"><Pill size={23}/></span><span><strong>{plan.name}</strong><small>{plan.archived ? 'Схема завершена' : today < plan.startDate ? `С ${labelDate(plan.startDate)}` : stage ? doseLabel({ ...plan, ...stage }) : 'Приём по схеме завершён'}{plan.titration.enabled && !plan.archived ? stage?.maintenance ? ' · постоянная доза' : stage ? ` · этап ${stage.index + 1}` : ' · титрация' : ''}</small><em>{plan.origin==='doctor'?'От врача · ':''}{plan.times.join(' · ')}{mealLabel(plan.meal) ? ` · ${mealLabel(plan.meal)}` : ''}</em></span><CaretRight size={18}/></button>;
  };
  return <><HistoryStatus resource={history}/>
    <section className="plan-banner med-treatment-banner"><ContourCanvas value={themeValue}/><div><span className="section-kicker">В СВОЁМ РИТМЕ</span><h2>Забота — по одному<br/>небольшому шагу</h2><p>{selectedDay === today ? 'Ваш план на сегодня' : `Приёмы за ${labelDate(selectedDay)}`}</p></div>{rows.length > 0 && <div className="plan-progress"><span>{completed}<small> / {rows.length}</small></span><p>приёмов отмечено</p><progress aria-label="Отмеченные приёмы" value={completed} max={rows.length}/></div>}</section>
    <div className="treatment-columns medication-columns"><div><div className="med-section-heading"><h2>{selectedDay === today ? 'Сегодня' : labelDate(selectedDay)}</h2><DatePicker label="День" value={selectedDay} onChange={setSelectedDay}/></div>
      {rows.length ? <div className="med-intake-list">{rows.map(row => <article className={`med-intake-row is-${row.status}`} key={row.id}><time>{row.time}</time><div className="med-intake-main"><button className="med-intake-name" onClick={() => openDetails(plans.find(plan => plan.id === row.planId))}>{row.name}<ArrowUpRight size={14}/></button><p>{doseLabel(row)}{mealLabel(row.meal) ? ` · ${mealLabel(row.meal)}` : ''}</p>{row.previousSchedule && <small>По прежней схеме</small>}{row.status === 'planned' ? <div className="med-intake-actions"><button className="secondary-button" disabled={pendingDoses.includes(row.id) || !storageReady} aria-label={`Отметить приём ${row.name} в ${row.time}`} onClick={() => mark(row, 'taken')}><Check size={16}/>Принят</button><button className="text-button" disabled={pendingDoses.includes(row.id) || !storageReady} aria-label={`Отметить пропуск ${row.name} в ${row.time}`} onClick={() => mark(row, 'skipped')}>Пропущен</button></div> : <div className="med-intake-recorded"><span><Check size={15}/>{row.status === 'taken' ? 'Принят' : 'Пропущен'}<small>· {timeLabel(row.statusAt)}</small></span><button className="icon-button" aria-label={`Изменить отметку ${row.name} в ${row.time}`} disabled={pendingDoses.includes(row.id)} onClick={() => mark(row, 'planned')}><ArrowCounterClockwise size={17}/></button></div>}</div></article>)}</div> : <section className="med-treatment-empty"><span className="workspace-icon"><Pill size={29}/></span><h3>{current.length ? 'На этот день приёмов нет' : 'Начните со своей схемы'}</h3><p>{current.length ? 'Даты и время можно посмотреть в карточке препарата.' : 'Добавьте препарат и перенесите назначение: дозировку, время и этапы титрации.'}</p>{!current.length && <button className="primary" onClick={() => openNew()}><Plus size={18}/>Добавить препарат</button>}</section>}
      <p className="med-local-reminder-note"><Bell size={16}/>Напоминания пока доступны внутри приложения.</p>
    </div><aside className="medication-plan-column"><div className="med-section-heading"><h2>Мои препараты</h2><button className="icon-button med-add-plan" aria-label="Управление препаратами" onClick={() => onOpen('health')}><Plus size={22}/></button></div>{medicationRows.length ? <div className="med-plan-list">{medicationRows.map(row=>row.fromTherapy?planCard(row.plan):<button key={row.id} className="med-plan-card" onClick={()=>onOpen('health')}><span className="workspace-icon"><Pill size={23}/></span><span><strong>{row.name}</strong><small>{row.details||'Внесено без расписания'}</small><em>Из списка принимаемых</em></span><CaretRight size={18}/></button>)}</div> : <p className="med-no-plans">Здесь появятся ваши схемы приёма.</p>}<button className="text-button" onClick={()=>openNew()}><Plus size={17}/>Добавить схему приёма</button>{drafts.new?.name && <button className="text-button med-draft-continue" onClick={() => openNew()}><PencilSimple size={17}/>Продолжить черновик</button>}{archived.length > 0 && <details className="med-archive-list"><summary>Завершённые схемы <span>{archived.length}</span></summary>{archived.map(planCard)}</details>}
      <div className="workspace-section-head"><h2>Самочувствие</h2></div><section className="rounded-list"><Row icon={ClipboardText} title="Опросники" subtitle="PHQ-9 и GAD-7" onClick={() => onOpen('questionnaire')}/><Row icon={Moon} title="Сон" subtitle="Длительность и качество отдыха" onClick={() => onOpen('sleep')}/></section><button className="text-button med-profile-link" onClick={() => onOpen('health')}><ShieldCheck size={17}/>Сведения для врача<CaretRight size={15}/></button>
    </aside></div>
    {editor && <Modal title={editor.mode === 'edit' ? editor.planId ? 'Изменить схему' : 'Новый препарат' : 'Схема приёма'} className={`medication-modal ${closing ? 'is-closing' : ''}`} closeDisabled={pending} onClose={close}>
      {editor.mode === 'edit' && drafts[editor.key] ? <MedicationEditor draft={drafts[editor.key]} onChange={draft => setDrafts(old => ({ ...old, [editor.key]: draft }))} onSubmit={saveDraft} pending={pending} error={error} conflict={conflict} onReload={reloadDraft} storageReady={storageReady} nameField={<ProductPicker name={drafts[editor.key].name} productId={drafts[editor.key].productId} onChange={patch=>setDrafts(old=>({...old,[editor.key]:applyProductSelection(old[editor.key],patch)}))}/>} /> : selectedPlan && <>{archiveConfirm ? <><div className="medication-sheet-scroll med-archive-confirm"><span className="workspace-icon"><Archive size={28}/></span><h3>Завершить эту схему?</h3><strong className="med-archive-name">{selectedPlan.name}</strong><p>Будущие приёмы исчезнут из плана. Уже отмеченные приёмы и предыдущие версии останутся в истории.</p></div><footer className="medication-sheet-footer">{error && <p className="journal-error" role="alert">{error}</p>}<button className="primary full-width" disabled={pending} onClick={archive}>{pending ? 'Сохраняем…' : 'Завершить схему'}</button><button className="text-button" disabled={pending} onClick={() => setArchiveConfirm(false)}>Вернуться к схеме</button></footer></> : <PlanDetails plan={selectedPlan} onEdit={edit} onArchive={archive} onCopy={() => openNew(selectedPlan)} pending={pending} error={error}/>}</>}
    </Modal>}
  </>;
}
