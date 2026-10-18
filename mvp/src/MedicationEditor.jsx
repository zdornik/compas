import { useLayoutEffect, useRef, useState } from 'react';
import { Plus, X, Clock, Check, SlidersHorizontal } from '@phosphor-icons/react';
import { DatePicker, TimeWheel } from './DateTimeControls.jsx';
import { addDays, doseLabel, isCalendarDate, MEDICATION_UNITS, MEAL_OPTIONS } from './medications.js';
import { dateLabel } from './domain.js';

export function IosSwitch({ checked, onChange, label, disabled = false }) {
  return <button type="button" className="ios-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span/></button>;
}

function SmoothReveal({ open, children, className = '' }) {
  const content = useRef(null);
  const [height, setHeight] = useState(open ? null : 0);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const measure = () => setHeight(open ? Math.ceil(content.current.getBoundingClientRect().height) : 0);
    const observer = new ResizeObserver(measure); observer.observe(content.current); measure();
    const frame = requestAnimationFrame(() => setReady(true));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [open]);
  return <div className={`med-reveal ${ready ? 'reveal-ready' : ''} ${open ? 'revealed' : ''} ${className}`} style={{ height: height ?? undefined }} aria-hidden={!open} inert={!open}><div ref={content} className="med-reveal-content">{children}</div></div>;
}

function DoseFields({ value, onChange, form, unit, prefix }) {
  const valid = Number(String(value.strength).replace(',', '.')) > 0 && Number(String(value.quantity).replace(',', '.')) > 0;
  return <><div className="med-dose-fields"><label><span>Дозировка {form === 'capsule' ? 'капсулы' : 'таблетки'}</span><div className="med-unit-input"><input aria-label={`${prefix}: дозировка ${form === 'capsule' ? 'капсулы' : 'таблетки'}`} type="text" inputMode="decimal" autoComplete="off" value={value.strength} onChange={event => onChange({ strength: event.target.value })} placeholder="—"/><span>{unit}</span></div></label><label><span>На один приём</span><div className="med-unit-input"><input aria-label={`${prefix}: количество ${form === 'capsule' ? 'капсул' : 'таблеток'}`} type="text" inputMode="decimal" autoComplete="off" value={value.quantity} onChange={event => onChange({ quantity: event.target.value })} placeholder="—"/><span>{form === 'capsule' ? 'капс.' : 'табл.'}</span></div></label></div>{valid && <p className="med-dose-equivalent">{doseLabel({ ...value, strength: Number(String(value.strength).replace(',', '.')), quantity: Number(String(value.quantity).replace(',', '.')), form, unit })} на приём</p>}</>;
}

function TimeSlots({ times, onChange }) {
  const [editing, setEditing] = useState(null);
  const add = () => {
    const next = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`).find(time => !times.includes(time));
    if (next) { onChange([...times, next]); setEditing(times.length); }
  };
  return <div className="med-times"><div className="med-time-chips">{times.map((time, index) => <div key={index} className={`med-time-chip ${editing === index ? 'editing' : ''}`}><button type="button" aria-label={`Изменить время приёма ${time}`} aria-expanded={editing === index} onClick={() => setEditing(editing === index ? null : index)}><Clock size={17}/>{time}</button>{times.length > 1 && <button type="button" aria-label={`Убрать время ${time}`} onClick={() => { onChange(times.filter((_, i) => i !== index)); setEditing(null); }}><X size={14}/></button>}</div>)}{times.length < 8 && <button type="button" className="med-add-time" onClick={add}><Plus size={17}/>Время</button>}</div>{editing !== null && times[editing] && <div className="med-time-popover"><TimeWheel value={times[editing]} onChange={time => onChange(times.map((old, i) => i === editing ? time : old))}/><button type="button" className="text-button" onClick={() => setEditing(null)}><Check size={16}/>Готово</button></div>}</div>;
}

export function MedicationEditor({ draft, onChange, onSubmit, pending, error, conflict, onReload, storageReady, nameField, caption = 'Перенесите точную схему из назначения врача.', submitLabel = 'Сохранить схему' }) {
  const update = patch => onChange({ ...draft, ...patch });
  const titration = draft.titration;
  const updateTitration = patch => update({ titration: { ...titration, ...patch } });
  const toggleTitration = enabled => {
    const stages = titration.stages.length ? titration.stages.map((stage, index) => index === 0 ? { ...stage, strength: stage.strength || draft.strength, quantity: stage.quantity || draft.quantity } : stage) : [{ days: '', strength: draft.strength, quantity: draft.quantity }, { days: '', strength: '', quantity: '' }];
    update({ ...(enabled ? {} : { strength: stages[0].strength, quantity: stages[0].quantity }), titration: { ...titration, enabled, stages } });
  };
  const updateStage = (index, patch) => updateTitration({ stages: titration.stages.map((stage, i) => i === index ? { ...stage, ...patch } : stage) });
  let nextDate = draft.startDate;
  return <form className="medication-editor-form" noValidate onSubmit={event => {
    event.preventDefault();
    onSubmit();
  }}>
    <div className="medication-sheet-scroll"><fieldset className="medication-editor-fields" disabled={pending}>
      <p className="med-editor-caption"><SlidersHorizontal size={18}/>{caption}</p>
      {nameField || <label className="med-field med-name-field"><span>Название препарата</span><input type="text" maxLength={120} autoComplete="off" aria-label="Название препарата" value={draft.name} onChange={event => update({ name: event.target.value })} placeholder="Введите название"/></label>}
      {draft.doseAutofill&&<p className="input-hint">Из ГРЛС: минимальная указанная дозировка {draft.doseAutofill}, 1 таблетка/капсула. Измените по назначению врача.</p>}<section className="med-form-section"><h3>Когда принимать</h3><div className="med-dates"><DatePicker value={draft.startDate} max="2100-12-31" label="Начало" onChange={startDate => update({ startDate })}/>{draft.endDate ? <div className="med-end-date"><DatePicker value={draft.endDate} max="2100-12-31" label="Окончание" onChange={endDate => update({ endDate })}/><button type="button" className="icon-button" aria-label="Убрать дату окончания" onClick={() => update({ endDate: null })}><X size={16}/></button></div> : !(titration.enabled && titration.after === 'finish') && <button type="button" className="text-button med-set-end" onClick={() => update({ endDate: draft.startDate })}><Plus size={15}/>Дата окончания</button>}</div><div className="med-field-heading"><span>Ежедневно</span><small>Время Москвы</small></div><TimeSlots times={draft.times} onChange={times => update({ times })}/></section>
      <section className="med-form-section"><div className="med-titration-toggle"><div><h3>Титрация</h3><p>Дозировка меняется по этапам</p></div><IosSwitch checked={titration.enabled} onChange={toggleTitration} label="Титрация" disabled={pending}/></div>
        <div className="med-units-row"><span className="med-field-label">Единицы дозировки</span><div className="med-unit-options" role="group" aria-label="Единицы дозировки"><span className="med-unit-glider" aria-hidden="true" style={{ transform: `translateX(${draft.unit === 'мкг' ? 100 : 0}%)` }}/>{MEDICATION_UNITS.map(unit => <button type="button" key={unit} aria-pressed={draft.unit === unit} onClick={() => update({ unit })}>{unit}</button>)}</div></div>
        <SmoothReveal open={!titration.enabled}><DoseFields value={draft} onChange={update} form={draft.form} unit={draft.unit} prefix="Постоянная схема"/></SmoothReveal>
        <SmoothReveal open={titration.enabled} className="med-titration-expand">
          <div className="med-stages">{titration.stages.map((stage, index) => {
            const valid = isCalendarDate(nextDate) && Number.isInteger(Number(stage.days)) && Number(stage.days) > 0 && Number(stage.days) <= 365;
            const start = nextDate, end = valid ? addDays(start, Number(stage.days) - 1) : null;
            nextDate = end ? addDays(end, 1) : null;
            return <section key={index} className="med-stage"><div className="med-stage-heading"><span>{String(index + 1).padStart(2, '0')}</span><div><h4>Этап {index + 1}</h4><p>{end ? `${dateLabel(`${start}T12:00:00Z`)} — ${dateLabel(`${end}T12:00:00Z`)}` : 'Укажите длительность этапа'}</p></div>{titration.stages.length > 2 && <button type="button" className="icon-button" aria-label={`Убрать этап ${index + 1}`} onClick={() => updateTitration({ stages: titration.stages.filter((_, i) => i !== index) })}><X size={17}/></button>}</div><label className="med-stage-days"><span>Период</span><div className="med-unit-input"><input type="text" inputMode="numeric" autoComplete="off" aria-label={`Этап ${index + 1}: период в днях`} value={stage.days} placeholder="—" onChange={event => updateStage(index, { days: event.target.value })}/><span>дн.</span></div></label><DoseFields value={stage} onChange={patch => updateStage(index, patch)} form={draft.form} unit={draft.unit} prefix={`Этап ${index + 1}`}/></section>;
          })}</div>
          {titration.stages.length < 12 && <button type="button" className="secondary-button med-add-stage" onClick={() => updateTitration({ stages: [...titration.stages, { days: '', strength: '', quantity: '' }] })}><Plus size={17}/>Добавить этап</button>}
          <div className="med-after-stages"><span className="med-field-label">После последнего этапа</span><div className="med-after-options" role="group" aria-label="После титрации"><button type="button" aria-pressed={titration.after === 'maintain'} onClick={() => updateTitration({ after: 'maintain' })}>Продолжать последнюю дозу</button><button type="button" aria-pressed={titration.after === 'finish'} onClick={() => update({ endDate: null, titration: { ...titration, after: 'finish' } })}>Завершить схему</button></div><p>Этапы сменяются по календарным дням. Отметки приёмов не сдвигают даты.</p></div>
        </SmoothReveal>
      </section>
      <section className="med-meal-section"><h3>Связь с едой</h3><div className="med-meal-options" role="group" aria-label="Связь с едой">{MEAL_OPTIONS.map(option => <button type="button" key={option.id} aria-label={option.id === 'unspecified' ? 'Связь с едой не указана' : option.label} aria-pressed={(draft.meal || 'unspecified') === option.id} onClick={() => update({ meal: option.id })}>{option.label}</button>)}</div></section>
      <label className="med-field med-instructions"><span>Указания к приёму</span><textarea rows={3} maxLength={2000} value={draft.instructions} onChange={event => update({ instructions: event.target.value })} placeholder="Особенности приёма из назначения"/></label>
      {draft.expectedRevision > 0 && <p className="med-editor-history-note">Изменения действуют с сегодняшнего дня. Уже отмеченные приёмы сохранят прежнюю дозировку.</p>}
    </fieldset></div>
    <footer className="medication-sheet-footer">{error && <p className="journal-error" role="alert">{error}</p>}{conflict && <button type="button" className="text-button" onClick={onReload}>Перечитать актуальную схему</button>}<button type="submit" className="primary full-width" disabled={pending || !storageReady}>{pending ? 'Сохраняем…' : submitLabel}</button>{!storageReady && <p className="med-save-caption">Сохранение доступно после подключения базы.</p>}</footer>
  </form>;
}
