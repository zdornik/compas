import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMoodEntry, changeDoseStatus, dayKey, timeLabel, MOODS } from '../src/domain.js';

test('Moscow date rolls over correctly across UTC midnight boundary', () => {
  assert.equal(dayKey(new Date('2026-10-17T22:10:00Z')), '2026-10-18');
  assert.equal(timeLabel('2026-10-17T22:10:00Z'), '01:10');
});
test('a mood entry validates its range and does not carry words from another mood', () => {
  const args = { value: 1, words: ['Грусть', 'Восторг'], factors: ['Сон', 'made-up'], note: '  test  ', kind: 'moment' };
  const entry = makeMoodEntry(args, new Date('2026-10-17T10:00:00Z'));
  assert.deepEqual(entry.words, ['Грусть']); assert.deepEqual(entry.factors, ['Сон']);
  assert.equal(entry.note, 'test'); assert.equal(entry.at, '2026-10-17T10:00:00.000Z');
  assert.throws(() => makeMoodEntry({ ...args, value: -1 }));
  assert.throws(() => makeMoodEntry({ ...args, value: 7 }));
  assert.throws(() => makeMoodEntry({ ...args, value: 1.5 }));
  assert.equal(makeMoodEntry({ ...args, note: 'a'.repeat(1200) }).note.length, 1000);
});
test('marking one medication neither changes another nor duplicates the dose', () => {
  const doses = [{ id: 'a', status: 'planned' }, { id: 'b', status: 'planned' }];
  const changed = changeDoseStatus(doses, 'a', 'taken');
  assert.equal(changed.length, 2); assert.equal(changed[0].status, 'taken'); assert.equal(changed[1].status, 'planned');
  assert.equal(doses[0].status, 'planned');
  assert.deepEqual(changeDoseStatus(changed, 'a', 'taken'), changed);
  assert.equal(changeDoseStatus(changed, 'a', 'planned')[0].status, 'planned');
  assert.deepEqual(changeDoseStatus(doses, 'a', 'wrong'), doses);
});
test('mood ends are blue and yellow with a green midpoint', () => {
  assert.equal(MOODS[0].tone, 'blue'); assert.equal(MOODS[3].tone, 'sage'); assert.equal(MOODS[6].tone, 'yellow');
});

test('a backdated mood belongs to the chosen day, not its creation day', () => {
  const now = new Date('2026-10-17T22:10:00Z');
  const entry = makeMoodEntry({ value: 2, words: [], factors: [], note: 'yesterday', kind: 'day', date: '2026-10-17' }, now);
  assert.equal(entry.day, '2026-10-17');
  assert.equal(dayKey(new Date(entry.at)), '2026-10-17');
  assert.equal(entry.createdAt, now.toISOString());
  assert.notEqual(dayKey(new Date(entry.at)), dayKey(new Date(entry.createdAt)));
});
test('invalid and future observation days are rejected rather than silently moved to today', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  const args = { value: 3, words: [], factors: [], note: '', kind: 'day' };
  for (const date of ['2026-02-30', '2026-13-01', '', '2026-10-18']) assert.throws(() => makeMoodEntry({ ...args, date }, now));
});
test('adding yesterday never replaces the mood of today', async () => {
  const { latestMoodForDay } = await import('../src/domain.js');
  const now = new Date('2026-10-17T10:00:00Z');
  const args = { words: [], factors: [], note: '', kind: 'day' };
  const today = makeMoodEntry({ ...args, value: 5, date: '2026-10-17' }, now);
  const yesterday = makeMoodEntry({ ...args, value: 1, date: '2026-10-16' }, now);
  assert.equal(latestMoodForDay([yesterday, today], '2026-10-17').id, today.id);
  assert.equal(latestMoodForDay([yesterday, today], '2026-10-16').id, yesterday.id);
});
test('home uses the latest observation time, with actual entries ahead of future-dated examples', async () => {
  const { latestMoodForDay } = await import('../src/domain.js');
  const older = { id: 'old', type: 'mood', day: '2026-10-17', at: '2026-10-17T10:00:00Z' };
  const newer = { ...older, id: 'new', at: '2026-10-17T11:00:00Z' };
  const sample = { ...older, id: 'sample', at: '2026-10-17T18:00:00Z', sample: true };
  assert.equal(latestMoodForDay([older, sample, newer], '2026-10-17').id, 'new');
});
test('whole-app colours share the continuous mood palette and keep readable primary controls', async () => {
  const { appThemeAt } = await import('../src/mood-motion.js');
  const themes = Array.from({ length: 7 }, (_, i) => appThemeAt(i));
  for (const token of ['--ui-accent', '--ui-soft', '--ui-selected', '--ui-line', '--ui-ink', '--ui-paper']) assert.equal(new Set(themes.map(theme => theme[token])).size, 7);
  const luminance = value => value.match(/[\d.]+/g).map(Number).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  for (const theme of themes) assert.ok(1.05 / (luminance(theme['--accent']) + .05) >= 4.5);
});
test('all seven sub-states have distinct palettes and progressive facial expressions', async () => {
  const { MOOD_VISUALS } = await import('../src/mood-motion.js');
  assert.equal(new Set(MOOD_VISUALS.map(m => m.background)).size, 7);
  assert.equal(MOOD_VISUALS.length, MOODS.length);
  assert.ok(MOOD_VISUALS.every((m, i) => i === 0 || m.mouth > MOOD_VISUALS[i - 1].mouth));
});

test('palette transitions pass through the exact midpoint and continuous adjacent colours', async () => {
  const { contourPalette } = await import('../src/mood-motion.js');
  assert.deepEqual(contourPalette(3), { inner: [155, 194, 174], outer: [240, 247, 242] });
  const start = contourPalette(2), middle = contourPalette(2.5), end = contourPalette(3);
  for (let i = 0; i < 3; i++) assert.equal(middle.outer[i], (start.outer[i] + end.outer[i]) / 2);
  assert.deepEqual(contourPalette(-1), contourPalette(0));
  assert.deepEqual(contourPalette(10), contourPalette(6));
});

test('eye geometry stays upright between all neighbouring states', async () => {
  const { moodVisualAt } = await import('../src/mood-motion.js');
  for (let i = 0; i <= 600; i++) {
    const visual = moodVisualAt(i / 100);
    assert.ok(visual.eyes > 0.65, 'eyes must never flatten or invert');
  }
});

test('the innermost contour follows the mascot and covers the sheet at every viewport', async () => {
  const { contourPlacement, ENVIRONMENT: a } = await import('../src/contour-placement.js');
  for (const [width, height] of [[320, 620], [390, 700], [540, 730]]) {
    const centerX = width / 2, centerY = height * .48;
    const p = contourPlacement({ width, height, centerX, centerY, figureWidth: 196, figureHeight: 245 });
    const scale = p.width / a.width;
    assert.ok(Math.abs(p.left + a.anchorX * scale - centerX) < .001);
    assert.ok(Math.abs(p.top + a.anchorY * scale - centerY) < .001);
    assert.ok(p.left <= 0 && p.top <= 0);
    assert.ok(p.left + p.width >= width && p.top + p.height >= height);
  }
});

test('neutral has no dark-green dip in the progression of contour lightness', async () => {
  const { contourPalette } = await import('../src/mood-motion.js');
  const luminance = rgb => rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  for (let i = 1; i <= 6; i++) assert.ok(luminance(contourPalette(i).inner) >= luminance(contourPalette(i - 1).inner));
});

test('the second step shrinks environment and character by the same ratio', async () => {
  const { contourPlacement } = await import('../src/contour-placement.js');
  const first = contourPlacement({ width: 540, height: 730, centerX: 270, centerY: 350, figureWidth: 196, figureHeight: 245, cover: false });
  const compact = contourPlacement({ width: 540, height: 600, centerX: 270, centerY: 200, figureWidth: 130, figureHeight: 245 * 130 / 196, cover: false });
  assert.ok(Math.abs(compact.width / first.width - 130 / 196) < .0001);
  assert.ok(Math.abs(compact.height / first.height - 130 / 196) < .0001);
});

test('button and progress accents interpolate between states instead of rounding', async () => {
  const { moodChromeAt } = await import('../src/mood-motion.js');
  const a = moodChromeAt(2)['--accent'], middle = moodChromeAt(2.5)['--accent'], b = moodChromeAt(3)['--accent'];
  assert.notEqual(middle, a); assert.notEqual(middle, b);
  assert.notEqual(moodChromeAt(2.49)['--accent'], moodChromeAt(2.51)['--accent']);
});

test('journal notes support long paragraphs independently from mood entries', async () => {
  const { makeJournalEntry } = await import('../src/domain.js');
  const body = 'Первый абзац\n\n' + 'Большой текст о мыслях и чувствах. '.repeat(160);
  const now = new Date('2026-10-17T10:00:00Z');
  const entry = makeJournalEntry({ title: '  Моя запись  ', body, date: '2026-10-16' }, now);
  assert.equal(entry.type, 'journal'); assert.equal(entry.title, 'Моя запись');
  assert.equal(entry.body, body.trim()); assert.ok(entry.body.length > 1000);
  assert.equal(entry.day, '2026-10-16'); assert.equal(dayKey(new Date(entry.at)), '2026-10-16');
  assert.equal(entry.createdAt, now.toISOString());
  assert.equal('value' in entry, false);
});
test('editing a journal note preserves identity and observation time without duplicating', async () => {
  const { makeJournalEntry } = await import('../src/domain.js');
  const entry = makeJournalEntry({ title: '', body: 'Начало', date: '2026-10-16' }, new Date('2026-10-17T10:00:00Z'));
  const edited = makeJournalEntry({ ...entry, body: 'Продолжение\n\nЕщё один абзац', date: entry.day }, new Date('2026-10-17T11:00:00Z'));
  assert.equal(edited.id, entry.id); assert.equal(edited.at, entry.at); assert.equal(edited.createdAt, entry.createdAt);
  assert.notEqual(edited.updatedAt, entry.updatedAt);
  const redated = makeJournalEntry({ ...edited, date: '2026-10-17' }, new Date('2026-10-17T12:00:00Z'));
  assert.equal(redated.id, entry.id); assert.equal(dayKey(new Date(redated.at)), '2026-10-17');
});
test('journal validation rejects empty, oversized and future-dated notes', async () => {
  const { makeJournalEntry, JOURNAL_LIMIT } = await import('../src/domain.js');
  const now = new Date('2026-10-17T10:00:00Z');
  for (const draft of [{ body: '  ' }, { body: 'a'.repeat(JOURNAL_LIMIT + 1) }, { title: 'a'.repeat(121), body: 'text' }, { body: 'text', date: '2026-10-18' }]) assert.throws(() => makeJournalEntry(draft, now));
});
