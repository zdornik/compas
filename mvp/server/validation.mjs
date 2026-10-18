import { makeJournalEntry, makeMoodEntry, entryTimestamp, validEntryDate, dayKey } from '../src/domain.js';
import { makeAssessmentEntry } from '../src/assessments.js';
import { makeMedicationPlan, makeMedicationDose, normalizeMedicationConfig } from '../src/medications.js';
import { makeMedicalProfile } from '../src/medical-profile.js';
const text = (value, limit) => typeof value === 'string' && value.length <= limit;
export function validateEntry(body, id, previous = null, now = new Date(), context = {}) {
  if (!body || typeof body !== 'object' || !/^[a-zA-Z0-9-]{1,80}$/.test(id) || body.id !== id) throw new Error('Некорректная запись');
  if(previous?.origin==='doctor'&&body.type==='medication-plan'){
    if(body.archived!==true)throw Object.assign(new Error('Назначение врача изменяет врач'),{status:403});
    const before=normalizeMedicationConfig(previous),after=normalizeMedicationConfig(body);
    if(!body.archived||JSON.stringify({...after,archived:before.archived})!==JSON.stringify(before))throw Object.assign(new Error('Назначение врача изменяет врач. Можно только убрать схему из текущих, сохранив историю'),{status:403});
    const archived=makeMedicationPlan(body,id,previous,now);if(archived===previous)return previous;
    return {...previous,...archived,lastChangedBy:{type:'patient',action:'archived',at:now.toISOString()}};
  }
  if (body.type === 'medical-profile') return makeMedicalProfile(body, previous, now);
  if (body.type === 'medication-plan') return makeMedicationPlan(body, id, previous, now);
  if (body.type === 'medication-dose') return makeMedicationDose(body, id, previous, context.plan, now);
  let record;
  const date = body.day;
  if (body.type === 'assessment') {
    record = makeAssessmentEntry(body.scaleId, body.answers, body.impact, now);
    if (previous) {
      if (previous.type !== 'assessment' || previous.scaleId !== body.scaleId || JSON.stringify(previous.answers) !== JSON.stringify(body.answers) || previous.impact !== record.impact) throw new Error('Сохранённый результат нельзя переписать. Пройдите опросник заново');
      return previous;
    }
  } else {
    if (!validEntryDate(date, now)) throw new Error('Выберите существующую дату не позднее сегодняшней');
    if (body.type === 'journal') {
      if (!text(body.title, 120) || !text(body.body, 20000)) throw new Error('Некорректный текст записи');
      record = makeJournalEntry({ ...previous, id, title: body.title, body: body.body, date }, now);
    } else if (body.type === 'mood') {
      if (!['moment', 'day'].includes(body.kind) || !Array.isArray(body.words) || !Array.isArray(body.factors) || body.words.length > 20 || body.factors.length > 20 || !text(body.note || '', 1000)) throw new Error('Некорректная отметка настроения');
      record = makeMoodEntry({ value: body.value, words: body.words, factors: body.factors, note: body.note || '', kind: body.kind, date }, now);
    } else if (body.type === 'sleep') {
      const hours = Number(body.hours), minutes = Number(body.minutes);
      if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || hours * 60 + minutes <= 0 || hours * 60 + minutes > 1440 || !['Плохо', 'Не очень', 'Нормально', 'Хорошо', 'Отлично'].includes(body.quality)) throw new Error('Проверьте длительность и качество сна');
      record = { type: 'sleep', hours, minutes, quality: body.quality, day: date, at: entryTimestamp(date, now) };
    } else throw new Error('Неизвестный тип записи');
  }
  if (previous && previous.type !== record.type) throw new Error('Тип сохранённой записи нельзя изменить');
  return { ...record, id, at: previous?.day === record.day && previous.at ? previous.at : record.at, createdAt: previous?.createdAt || now.toISOString(), updatedAt: now.toISOString() };
}
