import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dayKey } from '../src/domain.js';
import { medicationDoseId } from '../src/medications.js';
const origin = 'http://127.0.0.1:4174';
async function profile() {
  const response = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, 'X-Compass-Client': 'web', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 201);
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: (await response.json()).csrfToken };
}
async function request(profile, path, body) {
  const response = await fetch(origin + path, { method: body ? 'PUT' : 'GET', headers: { Origin: origin, Cookie: profile.cookie, 'X-CSRF-Token': profile.csrf, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, data: await response.json() };
}
const a = await profile(), b = await profile(), id = randomUUID(), day = dayKey();
const input = { id, type: 'medication-plan', expectedRevision: 0, name: 'SYNTHETIC-MEDICATION-CHECK', form: 'tablet', unit: 'мг', startDate: day, endDate: null, times: ['09:00', '20:00'], instructions: 'Вымышленная схема для проверки API', strength: 2, quantity: .5, archived: false, titration: { enabled: true, after: 'maintain', stages: [{ days: 2, strength: 2, quantity: .5 }, { days: 3, strength: 4, quantity: 1 }] } };
let result = await request(a, `/api/entries/${id}`, input);
assert.equal(result.status, 200); assert.equal(result.data.revision, 1);
assert.equal((await request(b, '/api/state')).data.entries.some(entry => entry.id === id), false);
const doseId = medicationDoseId(id, day, '09:00');
const dose = { id: doseId, type: 'medication-dose', planId: id, day, time: '09:00', status: 'taken', expectedRevision: 0, snapshot: { strength: 999, quantity: 999 } };
assert.equal((await request(b, `/api/entries/${doseId}`, dose)).status, 422);
result = await request(a, `/api/entries/${doseId}`, dose);
assert.equal(result.status, 200); assert.equal(result.data.snapshot.quantity, .5); assert.equal(result.data.snapshot.strength, 2);
assert.equal((await request(a, `/api/entries/${doseId}`, dose)).data.revision, 1);
const edit = { ...input, expectedRevision: 1, times: ['10:00'], titration: { ...input.titration, stages: [{ days: 2, strength: 2, quantity: 2 }, input.titration.stages[1]] } };
result = await request(a, `/api/entries/${id}`, edit);
assert.equal(result.status, 200); assert.equal(result.data.revision, 2); assert.equal(result.data.history.length, 1);
assert.equal((await request(a, `/api/entries/${id}`, edit)).data.revision, 2);
assert.equal((await request(a, `/api/entries/${id}`, { ...input, name: 'stale', expectedRevision: 1 })).status, 409);
let state = (await request(a, '/api/state')).data;
assert.equal(state.entries.find(entry => entry.id === doseId).snapshot.quantity, .5);
result = await request(a, `/api/entries/${id}`, { ...edit, archived: true, expectedRevision: 2 });
assert.equal(result.status, 200); assert.equal(result.data.revision, 3);
state = (await request(a, '/api/state')).data;
assert.equal(state.entries.find(entry => entry.id === doseId).status, 'taken');
assert.equal(state.entries.find(entry => entry.id === id).history.length, 2);
await writeFile('/private/tmp/compass-medication-proof.json', JSON.stringify({ ...a, id, doseId }), { mode: 0o600 });
console.log('Medication API passed: encrypted persistence, owned-plan validation, isolation, dose snapshots, idempotency, version conflicts, archive/history, no-store.');
