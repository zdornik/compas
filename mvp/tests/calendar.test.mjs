import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarPeriod, moveCalendar } from '../src/calendar.js';

test('weeks start on Monday and cross year boundaries without shifting days', () => {
  const period = calendarPeriod('week', '2027-01-01');
  assert.equal(period.days[0], '2026-12-28');
  assert.equal(period.days.at(-1), '2027-01-03');
  assert.equal(period.days.length, 7);
  assert.equal(calendarPeriod('week', '2026-12-31').key, period.key);
});

test('month grids include leap days and use the correct weekday offset', () => {
  const leap = calendarPeriod('month', '2028-02-29');
  assert.equal(leap.days.length, 29);
  assert.equal(leap.offset, 1);
  assert.equal(leap.days.at(-1), '2028-02-29');
  assert.equal(calendarPeriod('month', '2027-02-28').days.length, 28);
  assert.equal(calendarPeriod('month', '2026-03-01').offset, 6);
});

test('month navigation never skips February after the 31st', () => {
  assert.equal(moveCalendar('month', '2027-01-31', 1), '2027-02-01');
  assert.equal(moveCalendar('month', '2027-01-31', -1), '2026-12-01');
  assert.equal(moveCalendar('week', '2027-01-01', -1), '2026-12-25');
  assert.equal(moveCalendar('week', moveCalendar('week', '2027-01-01', 1), -1), '2027-01-01');
});

test('switching calendar modes can keep the selected historical day in view', () => {
  const selected = '2026-04-23';
  assert.ok(calendarPeriod('month', selected).days.includes(selected));
  assert.ok(calendarPeriod('week', selected).days.includes(selected));
  assert.equal(calendarPeriod('month', selected).days[0], '2026-04-01');
});
