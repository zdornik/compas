import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:4174';
const session = async () => {
  const response = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, 'X-Compass-Client': 'web', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  return { cookie, csrfToken: (await response.json()).csrfToken };
};
const request = async (path, profile, body, extra = {}) => {
  const response = await fetch(origin + path, { method: body ? 'PUT' : 'GET', headers: { Origin: origin, ...(profile ? { Cookie: profile.cookie, 'X-CSRF-Token': profile.csrfToken } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { response, data: await response.json() };
};
const a = await session(), b = await session();
assert.equal((await request('/api/state')).response.status, 401);
const id = randomUUID();
const note = { expectedRevision:0,mutationId:randomUUID(),id, type: 'journal', title: 'Проверка сохранения', body: `SYNTHETIC-COMPASS-CANARY-${id}`, day: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date()) };
assert.equal((await request(`/api/entries/${id}`, a, note, { 'X-CSRF-Token': 'wrong' })).response.status, 403);
assert.equal((await request(`/api/entries/${id}`, a, note, { Origin: 'https://other.invalid' })).response.status, 403);
assert.equal((await request(`/api/entries/${id}`, a, note)).response.status, 200);
assert.equal((await request(`/api/entries/${id}`, a, { ...note,expectedRevision:1,mutationId:randomUUID(), body: note.body + ' edited' })).response.status, 200);
const aState = await request('/api/state', a), bState = await request('/api/state', b);
assert.equal(aState.data.entries.filter(entry => entry.id === id).length, 1);
assert.equal(aState.data.entries.find(entry => entry.id === id).body, note.body + ' edited');
assert.equal(bState.data.entries.some(entry => entry.id === id), false);
const resultId = randomUUID();
const clinical = await request(`/api/entries/${resultId}`, a, { id: resultId, type: 'assessment', scaleId: 'gad7', answers: Array(7).fill(2), score: 0 });
assert.equal(clinical.response.status, 200); assert.equal(clinical.data.score, 14);
assert.equal((await request('/api/doses/one', a, { status: 'taken' })).response.status, 200);
assert.equal((await request('/api/state', a)).data.doses[0].status, 'taken');
assert.equal((await request('/api/state', b)).data.doses[0].status, 'planned');
assert.equal((await request('/api/state', a)).response.headers.get('cache-control'), 'no-store');
// A private, ignored proof fixture lets the restart check reuse this session.
await writeFile('/private/tmp/compass-api-proof.json', JSON.stringify({ ...a, id, body: note.body + ' edited' }), { mode: 0o600 });
console.log('API checks passed: persistence, idempotent edit, isolation, CSRF/Origin, server scoring, dose isolation, no-store.');
