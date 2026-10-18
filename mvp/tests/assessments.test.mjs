import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAssessmentEntry, scoreAssessment, SCALES } from '../src/assessments.js';

const answersFor = (scale, total) => Array.from({ length: SCALES[scale].questions.length }, () => { const value = Math.min(3, total); total -= value; return value; });
test('every PHQ-9 score, including each severity boundary, uses the original thresholds', () => {
  for (let total = 0; total <= 27; total++) {
    const result = scoreAssessment('phq9', answersFor('phq9', total));
    assert.equal(result.score, total); assert.equal(result.max, 27);
    assert.equal(result.level, total < 5 ? 0 : total < 10 ? 1 : total < 15 ? 2 : total < 20 ? 3 : 4);
  }
});
test('every GAD-7 score, including each severity boundary, uses the original thresholds', () => {
  for (let total = 0; total <= 21; total++) {
    const result = scoreAssessment('gad7', answersFor('gad7', total));
    assert.equal(result.score, total); assert.equal(result.max, 21);
    assert.equal(result.level, total < 5 ? 0 : total < 10 ? 1 : total < 15 ? 2 : 3);
  }
});
test('partial, sparse, invalid or unknown assessments never produce a score', () => {
  for (const answers of [[], Array(9), Array(9).fill(null), Array(9).fill(4), Array(9).fill(-1), Array(9).fill('1'), Array(9).fill(1.5), Array(8).fill(0)]) assert.throws(() => scoreAssessment('phq9', answers));
  assert.throws(() => scoreAssessment('unknown', Array(7).fill(0)));
});
test('any positive PHQ-9 item 9 needs separate follow-up, even with a low total', () => {
  for (const value of [1, 2, 3]) {
    const answers = Array(9).fill(0); answers[8] = value;
    assert.equal(scoreAssessment('phq9', answers).needsSafetyFollowUp, true);
  }
  assert.equal(scoreAssessment('phq9', [3, 3, 3, 3, 3, 3, 3, 3, 0]).needsSafetyFollowUp, false);
  assert.equal(scoreAssessment('gad7', Array(7).fill(3)).needsSafetyFollowUp, false);
});
test('functional impact is stored separately and never changes the PHQ score', () => {
  const answers = Array(9).fill(1);
  assert.throws(() => makeAssessmentEntry('phq9', answers));
  for (const impact of [0, 1, 2, 3]) {
    const record = makeAssessmentEntry('phq9', answers, impact, new Date('2026-10-17T14:00:00Z'));
    assert.equal(record.score, 9); assert.equal(record.impact, impact); assert.equal(record.day, '2026-10-17');
    assert.equal(record.type, 'assessment'); assert.equal(record.answers.length, 9);
    answers[0] = 3; assert.equal(record.answers[0], 1); answers[0] = 1;
  }
  assert.equal(makeAssessmentEntry('phq9', Array(9).fill(0)).impact, null);
  assert.equal(makeAssessmentEntry('gad7', Array(7).fill(1), 3).impact, null);
});
