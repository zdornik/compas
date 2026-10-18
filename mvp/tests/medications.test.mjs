import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMedicationConfig, makeMedicationPlan, makeMedicationDose, medicationDoseId, medicationSchedule, planForDay, stageForDay, totalDose, mealLabel, upcomingMedicationReminders } from '../src/medications.js';
import { validateEntry } from '../server/validation.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-17T10:00:00Z');
const config = () => ({ name: 'Вымышленный препарат', form: 'tablet', unit: 'мг', strength: '2,5', quantity: '0,5', startDate: '2026-10-17', endDate: null, times: ['20:00', '09:00'], instructions: '', archived: false, expectedRevision: 0, titration: { enabled: false, after: 'maintain', stages: [] } });
const titration = (after = 'maintain') => ({ ...config(), titration: { enabled: true, after, stages: [{ days: 2, strength: 2, quantity: .5 }, { days: 3, strength: 4, quantity: 1 }] } });

test('manual dose parsing handles decimal commas without unit conversion', () => {
  const plan = normalizeMedicationConfig(config());
  assert.equal(plan.strength, 2.5); assert.equal(plan.quantity, .5); assert.equal(totalDose(plan), 1.25);
  assert.deepEqual(plan.times, ['09:00', '20:00']);
  assert.equal(normalizeMedicationConfig({ ...config(), unit: 'мкг' }).strength, 2.5);
});
test('invalid, duplicate or empty schedules and malformed quantities are rejected', () => {
  for (const patch of [{ times: [] }, { times: ['09:00', '09:00'] }, { times: ['24:00'] }, { strength: '' }, { strength: 0 }, { quantity: -1 }, { quantity: 'Infinity' }, { form: 'capsule', quantity: .5 }, { startDate: '2026-02-30' }, { endDate: '2026-10-16' }]) assert.throws(() => normalizeMedicationConfig({ ...config(), ...patch }));
});
test('titration boundaries are inclusive and use calendar days, independently of intake marks', () => {
  const plan = makeMedicationPlan(titration(), id, null, now);
  assert.equal(stageForDay(plan, '2026-10-16'), null);
  assert.equal(stageForDay(plan, '2026-10-17').index, 0);
  assert.equal(stageForDay(plan, '2026-10-18').index, 0);
  assert.equal(stageForDay(plan, '2026-10-19').index, 1);
  assert.equal(stageForDay(plan, '2026-10-21').index, 1);
  assert.equal(stageForDay(plan, '2026-10-22').maintenance, true);
  assert.equal(stageForDay(plan, '2026-10-22').strength, 4);
  assert.equal(stageForDay(makeMedicationPlan(titration('finish'), id, null, now), '2026-10-22'), null);
});
test('future starts, end dates and year rollover never create extra intakes', () => {
  const plan = makeMedicationPlan({ ...config(), startDate: '2026-12-31', endDate: '2027-01-01' }, id, null, now);
  assert.equal(medicationSchedule([plan], '2026-12-30').length, 0);
  assert.equal(medicationSchedule([plan], '2026-12-31').length, 2);
  assert.equal(medicationSchedule([plan], '2027-01-01').length, 2);
  assert.equal(medicationSchedule([plan], '2027-01-02').length, 0);
});
test('plan edits have version checks, retain history, and allow identical retries', () => {
  const plan = makeMedicationPlan(config(), id, null, now);
  const input = { ...config(), quantity: 1, expectedRevision: 1 };
  const edited = makeMedicationPlan(input, id, plan, new Date('2026-10-18T10:00:00Z'));
  assert.equal(edited.revision, 2); assert.equal(edited.history.length, 1);
  assert.equal(planForDay(edited, '2026-10-17').quantity, .5);
  assert.equal(planForDay(edited, '2026-10-18').quantity, 1);
  assert.deepEqual(makeMedicationPlan(input, id, edited, now), edited);
  assert.throws(() => makeMedicationPlan({ ...input, quantity: 2 }, id, edited, now), error => error.status === 409);
  assert.equal(plan.history.length, 0);
});
test('server derives dose snapshots from the owned plan, ignoring forged amounts', () => {
  const plan = makeMedicationPlan(config(), id, null, now);
  const doseId = medicationDoseId(id, '2026-10-17', '09:00');
  const input = { id: doseId, type: 'medication-dose', planId: id, day: '2026-10-17', time: '09:00', status: 'taken', expectedRevision: 0, strength: 999, quantity: 999, snapshot: { name: 'forged' } };
  const record = validateEntry(input, doseId, null, now, { plan });
  assert.equal(record.snapshot.strength, 2.5); assert.equal(record.snapshot.quantity, .5);
  assert.equal(record.snapshot.name, plan.name);
  assert.throws(() => validateEntry(input, doseId, null, now, {}));
  assert.throws(() => validateEntry({ ...input, time: '12:00', id: medicationDoseId(id, input.day, '12:00') }, medicationDoseId(id, input.day, '12:00'), null, now, { plan }));
});
test('taken doses keep their actual amount and time when the schedule changes', () => {
  const plan = makeMedicationPlan(config(), id, null, now), doseId = medicationDoseId(id, '2026-10-17', '09:00');
  const dose = makeMedicationDose({ planId: id, day: '2026-10-17', time: '09:00', status: 'taken', expectedRevision: 0 }, doseId, null, plan, now);
  const edited = makeMedicationPlan({ ...config(), times: ['10:00'], quantity: 2, expectedRevision: 1 }, id, plan, now);
  const rows = medicationSchedule([edited, dose], '2026-10-17');
  const old = rows.find(row => row.id === doseId);
  assert.equal(old.status, 'taken'); assert.equal(old.quantity, .5); assert.equal(old.time, '09:00'); assert.equal(old.previousSchedule, true);
  assert.equal(rows.find(row => row.time === '10:00').quantity, 2);
  const undone = makeMedicationDose({ ...dose, expectedRevision: 1, status: 'planned' }, doseId, dose, edited, now);
  assert.equal(undone.history[0].status, 'taken');
  assert.equal(medicationSchedule([edited, undone], '2026-10-17').length, 1);
  assert.throws(() => makeMedicationDose({ ...dose, expectedRevision: 2, status: 'taken' }, doseId, undone, edited, now));
});
test('archiving preserves recorded doses and previous days without a deletion', () => {
  const plan = makeMedicationPlan(config(), id, null, now), doseId = medicationDoseId(id, '2026-10-17', '09:00');
  const dose = makeMedicationDose({ planId: id, day: '2026-10-17', time: '09:00', status: 'skipped', expectedRevision: 0 }, doseId, null, plan, now);
  const archived = makeMedicationPlan({ ...config(), archived: true, expectedRevision: 1 }, id, plan, new Date('2026-10-18T10:00:00Z'));
  assert.equal(medicationSchedule([archived], '2026-10-18').length, 0);
  assert.equal(medicationSchedule([archived, dose], '2026-10-17').length, 2);
  assert.equal(archived.history.length, 1);
});
test('future dose marks and stale concurrent status changes are rejected', () => {
  const plan = makeMedicationPlan(config(), id, null, now);
  const input = { planId: id, day: '2026-10-17', time: '09:00', status: 'taken', expectedRevision: 0 };
  const doseId = medicationDoseId(id, input.day, input.time), record = makeMedicationDose(input, doseId, null, plan, now);
  assert.deepEqual(makeMedicationDose(input, doseId, record, plan, now), record);
  assert.throws(() => makeMedicationDose({ ...input, status: 'skipped' }, doseId, record, plan, now), error => error.status === 409);
  assert.throws(() => makeMedicationDose({ ...input, day: '2026-10-18' }, medicationDoseId(id, '2026-10-18', input.time), null, plan, now));
});

test('meal instructions are optional, validated, and included in server-derived doses', () => {
  assert.equal(mealLabel('unspecified'), null);
  assert.equal(normalizeMedicationConfig(config()).meal, 'unspecified');
  const plan = makeMedicationPlan({ ...config(), meal: 'after' }, id, null, now);
  assert.equal(mealLabel(plan.meal), 'После еды');
  assert.equal(medicationSchedule([plan], '2026-10-17')[0].meal, 'after');
  assert.throws(() => normalizeMedicationConfig({ ...config(), meal: 'made-up' }));
  const editedByOldForm = makeMedicationPlan({ ...config(), expectedRevision: 1, name: 'Новое название' }, id, plan, now);
  assert.equal(editedByOldForm.meal, 'after');
});
test('home reminders expire after their minute and never erase the treatment journal', () => {
  const plan = makeMedicationPlan(config(), id, null, now);
  assert.equal(upcomingMedicationReminders([plan], new Date('2026-10-17T05:59:00Z')).length, 2);
  assert.equal(upcomingMedicationReminders([plan], new Date('2026-10-17T06:00:59Z')).length, 2);
  const after = upcomingMedicationReminders([plan], new Date('2026-10-17T06:01:00Z'));
  assert.equal(after.length, 1); assert.equal(after[0].time, '20:00');
  assert.equal(upcomingMedicationReminders([plan], new Date('2026-10-17T17:01:00Z')).length, 0);
  assert.equal(medicationSchedule([plan], '2026-10-17').length, 2);
  const doseId = medicationDoseId(id, '2026-10-17', '09:00');
  const record = makeMedicationDose({ planId: id, day: '2026-10-17', time: '09:00', status: 'taken', expectedRevision: 0 }, doseId, null, plan, now);
  assert.equal(upcomingMedicationReminders([plan, record], new Date('2026-10-17T05:00:00Z')).length, 1);
});
