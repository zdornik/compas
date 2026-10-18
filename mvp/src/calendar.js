// Calendar arithmetic stays in UTC at noon; display days are Moscow day keys.
const dateFor = key => new Date(`${key}T12:00:00Z`);
const keyFor = date => date.toISOString().slice(0, 10);

export function calendarPeriod(view, anchor) {
  const start = dateFor(anchor);
  if (view === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  else start.setUTCDate(1);
  const count = view === 'week' ? 7 : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, index) => {
    const date = new Date(start); date.setUTCDate(date.getUTCDate() + index); return keyFor(date);
  });
  return { key: `${view}:${days[0]}`, days, offset: view === 'month' ? (start.getUTCDay() + 6) % 7 : 0 };
}

export function moveCalendar(view, anchor, amount) {
  const date = dateFor(anchor);
  if (view === 'week') date.setUTCDate(date.getUTCDate() + amount * 7);
  else { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount); }
  return keyFor(date);
}
