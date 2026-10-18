import { dayKey, validEntryDate } from './domain.js';

export const MEDICATION_UNITS = ['мг', 'мкг'];
export const MEDICATION_FORMS = { tablet: 'Таблетки', capsule: 'Капсулы' };
export const MEAL_OPTIONS = [
  { id: 'unspecified', label: '—', description: null },
  { id: 'before', label: 'До еды', description: 'До еды' },
  { id: 'with', label: 'Во время еды', description: 'Во время еды' },
  { id: 'after', label: 'После еды', description: 'После еды' },
  { id: 'any', label: 'Не важно', description: 'Независимо от еды' },
];
export const mealLabel = value => MEAL_OPTIONS.find(option => option.id === value)?.description || null;
const planIdPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const isCalendarDate = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= '1970-01-01' && day <= '2100-12-31' && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
export const addDays = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const daysBetween = (start, end) => Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);
export const formatAmount = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(value);
export const totalDose = dose => Math.round(dose.strength * dose.quantity * 1e6) / 1e6;
export const doseLabel = dose => `${formatAmount(dose.quantity)} ${dose.form === 'capsule' ? 'капс.' : 'табл.'} · ${formatAmount(totalDose(dose))} ${dose.unit}`;
const number = (value, max, message) => {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(message);
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error(message);
  const result = Number(text);
  if (!Number.isFinite(result) || result <= 0 || result > max) throw new Error(message);
  return result;
};
const doseFields = (input, form) => {
  const strength = number(input.strength, 1e6, 'Укажите дозировку одной таблетки или капсулы');
  const quantity = number(input.quantity, 1000, 'Укажите количество таблеток или капсул на один приём');
  if (form === 'capsule' && !Number.isInteger(quantity)) throw new Error('Для капсул укажите целое количество');
  return { strength, quantity };
};

export function normalizeMedicationConfig(input) {
  if(input.productId&&!/^grls:[a-f0-9]{64}$/.test(input.productId))throw new Error('Проверьте запись препарата в реестре');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) throw new Error('Введите название препарата, до 120 символов');
  if (!Object.hasOwn(MEDICATION_FORMS, input.form) || !MEDICATION_UNITS.includes(input.unit)) throw new Error('Проверьте форму препарата и единицы дозировки');
  if (!isCalendarDate(input.startDate) || (input.endDate && (!isCalendarDate(input.endDate) || input.endDate < input.startDate))) throw new Error('Проверьте даты начала и окончания схемы');
  if (!Array.isArray(input.times) || !input.times.length || input.times.length > 8 || input.times.some(time => typeof time !== 'string' || !timePattern.test(time))) throw new Error('Добавьте от одного до восьми времён приёма');
  if (new Set(input.times).size !== input.times.length) throw new Error('Время приёма не должно повторяться');
  if (typeof input.instructions !== 'string' || input.instructions.length > 2000) throw new Error('Сократите примечание до 2000 символов');
  const meal = input.meal ?? 'unspecified';
  if (!MEAL_OPTIONS.some(option => option.id === meal)) throw new Error('Выберите связь приёма с едой');
  if (typeof input.titration?.enabled !== 'boolean' || typeof input.archived !== 'boolean') throw new Error('Некорректные настройки схемы');
  let titration = { enabled: false, stages: [], after: 'maintain' };
  if (input.titration.enabled) {
    if (!Array.isArray(input.titration.stages) || input.titration.stages.length < 2 || input.titration.stages.length > 12) throw new Error('Для титрации добавьте от двух до двенадцати этапов');
    if (!['maintain', 'finish'].includes(input.titration.after)) throw new Error('Выберите, что делать после последнего этапа');
    titration = { enabled: true, after: input.titration.after, stages: input.titration.stages.map(stage => {
      const days = number(stage.days, 365, 'Укажите длительность каждого этапа в днях, от 1 до 365');
      if (!Number.isInteger(days)) throw new Error('Период этапа задаётся целым числом дней');
      return { days, ...doseFields(stage, input.form) };
    }) };
  }
  const endDate = titration.enabled && titration.after === 'finish' ? null : input.endDate || null;
  const lastDay = titration.enabled ? addDays(input.startDate, titration.stages.reduce((sum, stage) => sum + stage.days, 0) - 1) : null;
  if (lastDay && (!isCalendarDate(lastDay) || (endDate && endDate < lastDay))) throw new Error('Этапы титрации выходят за дату окончания схемы');
  return { name: input.name.trim(),productId:input.productId||null, form: input.form, unit: input.unit, meal, startDate: input.startDate, endDate, times: [...input.times].sort(), instructions: input.instructions.trim(), archived: input.archived, ...(titration.enabled ? doseFields(titration.stages[0], input.form) : doseFields(input, input.form)), titration };
}

export function medicationDraft(plan = null) {
  if (!plan) return { id: crypto.randomUUID(), expectedRevision: 0, name: '', form: 'tablet', unit: 'мг', meal: 'unspecified', startDate: dayKey(), endDate: null, times: ['09:00'], instructions: '', archived: false, strength: '', quantity: '', titration: { enabled: false, after: 'maintain', stages: [] } };
  const config = normalizeMedicationConfig(plan);
  return { id: plan.id, expectedRevision: plan.revision, ...structuredClone(config) };
}

export function makeMedicationPlan(input, id, previous = null, now = new Date()) {
  if (!planIdPattern.test(id) || (previous && previous.type !== 'medication-plan')) throw new Error('Некорректная схема');
  // Older open forms have no meal field; they must not erase an existing value.
  const config = normalizeMedicationConfig({ ...input, meal: input.meal ?? previous?.meal ?? 'unspecified' });
  const previousConfig = previous ? normalizeMedicationConfig(previous) : null;
  // An identical retry is idempotent, even after its first response was lost.
  if (previous && JSON.stringify(config) === JSON.stringify(previousConfig)) return previous;
  if (input.expectedRevision !== (previous?.revision || 0)) throw Object.assign(new Error('Схема изменена в другом окне. Перечитайте её перед сохранением'), { status: 409 });
  const history = previous ? [...previous.history, { ...previousConfig, revision: previous.revision, effectiveFrom: previous.effectiveFrom }] : [];
  return { id, type: 'medication-plan', ...config, revision: (previous?.revision || 0) + 1, history, effectiveFrom: now.toISOString(), day: previous?.day || dayKey(now), at: previous?.at || now.toISOString(), createdAt: previous?.createdAt || now.toISOString(), updatedAt: now.toISOString() };
}

export function planForDay(plan, day) {
  const versions = [...plan.history, plan];
  return versions.filter(version => dayKey(new Date(version.effectiveFrom)) <= day).at(-1) || versions[0];
}

export function stageForDay(plan, day) {
  if (plan.archived || day < plan.startDate || (plan.endDate && day > plan.endDate)) return null;
  if (!plan.titration.enabled) return { strength: plan.strength, quantity: plan.quantity, index: null, maintenance: false };
  let offset = daysBetween(plan.startDate, day);
  for (let index = 0; index < plan.titration.stages.length; index++) {
    const stage = plan.titration.stages[index];
    if (offset < stage.days) return { ...stage, index, maintenance: false };
    offset -= stage.days;
  }
  return plan.titration.after === 'maintain' ? { ...plan.titration.stages.at(-1), index: plan.titration.stages.length - 1, maintenance: true } : null;
}

export const medicationDoseId = (planId, day, time) => `dose-${planId}-${day.replaceAll('-', '')}-${time.replace(':', '')}`;
export function occurrenceForPlan(plan, day, time) {
  const version = planForDay(plan, day), stage = stageForDay(version, day);
  if (!stage || !version.times.includes(time)) return null;
  return { id: medicationDoseId(plan.id, day, time), planId: plan.id, day, time, name: version.name, form: version.form, unit: version.unit, meal: version.meal || 'unspecified', strength: stage.strength, quantity: stage.quantity, planRevision: version.revision, stageIndex: stage.index, maintenance: stage.maintenance };
}

export function medicationSchedule(entries, day = dayKey()) {
  const plans = entries.filter(entry => entry.type === 'medication-plan');
  const events = entries.filter(entry => entry.type === 'medication-dose' && entry.day === day);
  const rows = plans.flatMap(plan => planForDay(plan, day).times.map(time => occurrenceForPlan(plan, day, time)).filter(Boolean)).map(row => {
    const event = events.find(event => event.id === row.id);
    return event && event.status !== 'planned' ? { ...event.snapshot, status: event.status, eventRevision: event.revision, statusAt: event.statusAt, previousSchedule: event.snapshot.planRevision !== row.planRevision } : { ...row, status: 'planned', eventRevision: event?.revision || 0 };
  });
  // Already recorded intakes survive an edited time, dose, or archived plan.
  for (const event of events) if (event.status !== 'planned' && !rows.some(row => row.id === event.id)) rows.push({ ...event.snapshot, status: event.status, eventRevision: event.revision, statusAt: event.statusAt, previousSchedule: true });
  return rows.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
}

// Home shows today's unmarked reminders through their scheduled minute.
// Expiry affects this view only; the treatment journal retains every intake.
export function upcomingMedicationReminders(entries, now = new Date()) {
  const day = dayKey(now);
  return medicationSchedule(entries, day).filter(row => row.status === 'planned' && now.getTime() < Date.parse(`${day}T${row.time}:00+03:00`) + 60000);
}

export function makeMedicationDose(input, id, previous, plan, now = new Date()) {
  if (!plan || plan.type !== 'medication-plan' || !planIdPattern.test(input.planId) || plan.id !== input.planId || !validEntryDate(input.day, now) || !timePattern.test(input.time) || !['taken', 'skipped', 'planned'].includes(input.status) || id !== medicationDoseId(input.planId, input.day, input.time)) throw new Error('Проверьте препарат, дату и время отметки');
  if (previous && (previous.type !== 'medication-dose' || previous.planId !== input.planId || previous.day !== input.day || previous.time !== input.time)) throw new Error('Нельзя изменить принадлежность отметки приёма');
  if (previous?.status === input.status) return previous;
  if (input.expectedRevision !== (previous?.revision || 0)) throw Object.assign(new Error('Отметка изменена в другом окне. Обновите журнал'), { status: 409 });
  const occurrence = occurrenceForPlan(plan, input.day, input.time);
  if (!occurrence && (!previous || (previous.status === 'planned' && input.status !== 'planned'))) throw new Error('На это время приём по схеме не запланирован');
  const snapshot = previous && previous.status !== 'planned' ? previous.snapshot : occurrence || previous?.snapshot;
  return { id, type: 'medication-dose', planId: plan.id, day: input.day, time: input.time, status: input.status, snapshot, revision: (previous?.revision || 0) + 1, history: previous ? [...previous.history, { status: previous.status, at: previous.statusAt, snapshot: previous.snapshot }] : [], statusAt: now.toISOString(), at: `${input.day}T${input.time}:00+03:00`, createdAt: previous?.createdAt || now.toISOString(), updatedAt: now.toISOString() };
}
