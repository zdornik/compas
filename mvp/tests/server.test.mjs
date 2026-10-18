import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal, unseal, tokenHash } from '../server/crypto.mjs';
import { validateEntry } from '../server/validation.mjs';
const now = new Date('2026-10-17T13:05:00Z');
test('health payload encryption rejects tampering, wrong keys and another patient or record', () => {
  const key = randomBytes(32), payload = { body: 'synthetic canary', answers: [1, 0, 2] };
  const encrypted = seal(payload, key, 'patient-a:record-1');
  assert.deepEqual(unseal(encrypted, key, 'patient-a:record-1'), payload);
  assert.equal(encrypted.includes(Buffer.from(payload.body)), false);
  assert.throws(() => unseal(encrypted, key, 'patient-b:record-1'));
  assert.throws(() => unseal(encrypted, key, 'patient-a:record-2'));
  assert.throws(() => unseal(encrypted, randomBytes(32), 'patient-a:record-1'));
  const changed = Buffer.from(encrypted); changed[changed.length - 1] ^= 1;
  assert.throws(() => unseal(changed, key, 'patient-a:record-1'));
  assert.equal(tokenHash('token').length, 64);
});
test('server recomputes clinical scores and timestamps instead of trusting the browser', () => {
  const record = validateEntry({ id: 'test-result', type: 'assessment', scaleId: 'phq9', answers: Array(9).fill(1), impact: 2, score: 0, needsSafetyFollowUp: false, createdAt: '2000-01-01', day: '2000-01-01' }, 'test-result', null, now);
  assert.equal(record.score, 9); assert.equal(record.needsSafetyFollowUp, true);
  assert.equal(record.createdAt, now.toISOString()); assert.equal(record.day, '2026-10-17');
  assert.throws(() => validateEntry({ ...record, answers: Array(9).fill(0) }, record.id, record, now));
});
test('server edits long notes without changing identity, day or original time', () => {
  const input = { id: 'note-1', type: 'journal', title: 'Note', body: 'First text', day: '2026-10-16' };
  const old = validateEntry(input, input.id, null, now);
  const edited = validateEntry({ ...old, title: 'Edited', body: 'New text'.repeat(200), at: '2000-01-01', createdAt: '2000-01-01' }, old.id, old, now);
  assert.equal(edited.id, old.id); assert.equal(edited.at, old.at); assert.equal(edited.createdAt, old.createdAt);
  assert.equal(edited.body, 'New text'.repeat(200)); assert.equal(edited.title, 'Edited');
  assert.throws(() => validateEntry({ ...input, body: ' ' }, input.id, old, now));
  assert.throws(() => validateEntry({ ...input, day: '2026-10-18' }, input.id, null, now));
});
test('server rejects impossible sleep durations and malformed or retagged entries', () => {
  const sleep = { id: 'sleep-1', type: 'sleep', hours: 7, minutes: 30, quality: 'Хорошо', day: '2026-10-17' };
  assert.equal(validateEntry(sleep, sleep.id, null, now).minutes, 30);
  for (const duration of [{ hours: 24, minutes: 1 }, { hours: 0, minutes: 0 }, { hours: -1, minutes: 20 }, { hours: 7, minutes: 60 }]) assert.throws(() => validateEntry({ ...sleep, ...duration }, sleep.id, null, now));
  assert.throws(() => validateEntry(sleep, 'different-id', null, now));
  assert.throws(() => validateEntry(sleep, sleep.id, { type: 'journal' }, now));
});
