export const MOODS = [
  { name: 'Очень неприятно', short: 'Тяжело', tone: 'blue', words: ['Подавленность', 'Отчаяние', 'Тревога', 'Одиночество', 'Бессилие', 'Усталость'] },
  { name: 'Неприятно', short: 'Грустно', tone: 'blue', words: ['Грусть', 'Тревога', 'Раздражение', 'Усталость', 'Одиночество', 'Разочарование'] },
  { name: 'Немного неприятно', short: 'Неспокойно', tone: 'blue', words: ['Беспокойство', 'Скука', 'Усталость', 'Неуверенность', 'Раздражение', 'Грусть'] },
  { name: 'Нейтрально', short: 'Спокойно', tone: 'sage', words: ['Спокойствие', 'Равнодушие', 'Сосредоточенность', 'Усталость', 'Равновесие', 'Задумчивость'] },
  { name: 'Немного приятно', short: 'Неплохо', tone: 'sage', words: ['Спокойствие', 'Надежда', 'Облегчение', 'Благодарность', 'Уверенность', 'Интерес'] },
  { name: 'Приятно', short: 'Хорошо', tone: 'yellow', words: ['Радость', 'Благодарность', 'Удовлетворение', 'Уверенность', 'Нежность', 'Воодушевление'] },
  { name: 'Очень приятно', short: 'Радостно', tone: 'yellow', words: ['Восторг', 'Радость', 'Воодушевление', 'Любовь', 'Вдохновение', 'Благодарность'] },
];
export const FACTORS = ['Сон', 'Работа', 'Семья', 'Здоровье', 'Общение', 'Отношения', 'Учёба', 'Отдых', 'Погода', 'Другое'];
export const dayKey = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(date);
export const timeLabel = (date) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(date));
export const dateLabel = (date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(date));
export function changeDoseStatus(items, id, status) {
  if (!['taken', 'skipped', 'planned'].includes(status)) return items;
  return items.map(item => item.id === id ? { ...item, status } : item);
}
export function validEntryDate(date, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00+03:00`);
  return !Number.isNaN(parsed.getTime()) && dayKey(parsed) === date && date <= dayKey(now);
}
export function entryTimestamp(date = dayKey(), now = new Date()) {
  if (!validEntryDate(date, now)) throw new Error('Выберите существующую дату не позднее сегодняшней');
  if (date === dayKey(now)) return now.toISOString();
  // The observation day is independent from the time at which it was entered.
  return new Date(`${date}T${timeLabel(now)}:00+03:00`).toISOString();
}
export function latestMoodForDay(entries, date = dayKey()) {
  return entries.find(e => e.type === 'mood' && (e.day || dayKey(new Date(e.at))) === date);
}
export function makeMoodEntry({ value, words, factors, note, kind, date }, now = new Date()) {
  if (!Number.isInteger(value) || !MOODS[value]) throw new Error('Выберите настроение на шкале');
  date = date ?? dayKey(now);
  return { id: crypto.randomUUID(), type: 'mood', value, words: words.filter(w => MOODS[value].words.includes(w)), factors: factors.filter(f => FACTORS.includes(f)), note: note.trim().slice(0, 1000), kind, day: date, at: entryTimestamp(date, now), createdAt: now.toISOString() };
}
export function initialEntries() {
  const d = dayKey();
  return [
    { id: 'sample-mood', type: 'mood', value: 3, words: ['Спокойствие'], factors: ['Отдых'], note: 'После прогулки стало спокойнее. Вечером получилось отдохнуть.', kind: 'moment', at: `${d}T18:40:00+03:00`, sample: true },
    { id: 'sample-sleep', type: 'sleep', hours: '7', minutes: '20', quality: 'Хорошо', note: '', at: `${d}T08:10:00+03:00`, sample: true },
  ];
}
