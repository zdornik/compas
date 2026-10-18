// Public-domain PHQ/GAD instruments. Verbatim Russian for Russia forms and
// original scoring references, versions and implementation limits: ASSESSMENTS.md.
import { dayKey } from './domain.js';

export const ANSWER_OPTIONS = ['Ни разу', 'Несколько дней', 'Более недели', 'Почти каждый день'];
export const IMPACT_OPTIONS = ['Совсем не трудно', 'Немного трудно', 'Очень трудно', 'Чрезвычайно трудно'];
export const SCALES = {
  phq9: {
    id: 'phq9', name: 'PHQ-9', title: 'Симптомы депрессии', version: 'PHQ9_Russian for Russia', max: 27,
    instruction: 'Как часто за последние 2 недели Вас беспокоили следующие проблемы?',
    source: 'https://www.ecfs.eu/sites/default/files/general-content-files/working-groups/Mental%20Health/PHQ9_Russian%20for%20Russia.pdf',
    questions: [
      'Вам не хотелось ничего делать',
      'У Вас было плохое настроение. Вы были подавлены или испытывали чувство безысходности',
      'Вам было трудно заснуть, у Вас был прерывистый сон, или Вы слишком много спали',
      'Вы были утомлены, или у Вас было мало сил',
      'У Вас был плохой аппетит, или Вы переедали',
      'Вы плохо о себе думали: считали себя неудачником (неудачницей), или были в себе разочарованы, или считали, что подвели свою семью',
      'Вам было трудно сосредоточиться (например, на чтении газеты или на просмотре телепередач)',
      'Вы двигались или говорили настолько медленно, что окружающие это замечали? Или, наоборот, Вы были настолько суетливы или возбуждены, что двигались гораздо больше обычного',
      'Вас посещали мысли о том, что Вам лучше было бы умереть, или о том, чтобы причинить себе какой-нибудь вред',
    ],
    impact: 'Если Вы положительно ответили на какие-нибудь пункты, то оцените, насколько трудно Вам было работать, заниматься домашними делами или общаться с людьми из-за этих проблем?',
    thresholds: [5, 10, 15, 20],
    levels: ['Минимальная выраженность симптомов', 'Лёгкая выраженность симптомов', 'Умеренная выраженность симптомов', 'Умеренно тяжёлая выраженность симптомов', 'Тяжёлая выраженность симптомов'],
  },
  gad7: {
    id: 'gad7', name: 'GAD-7', title: 'Симптомы тревожности', version: 'GAD7_Russian for Russia', max: 21,
    instruction: 'Как часто Вас за последние 14 дней беспокоили следующие проблемы?',
    source: 'https://projectteachny.org/app/uploads/2022/07/GAD7_Russian-for-Russia.pdf',
    questions: [
      'Вы нервничали, тревожились или испытывали сильный стресс',
      'Вы были неспособны успокоиться или контролировать свое волнение',
      'Вы слишком сильно волновались по различным поводам',
      'Вам было трудно расслабиться',
      'Вы были настолько суетливы, что Вам было тяжело усидеть на месте',
      'Вы легко злились или раздражались',
      'Вы испытывали страх, словно должно произойти нечто ужасное',
    ],
    thresholds: [5, 10, 15],
    levels: ['Минимальная выраженность симптомов', 'Лёгкая выраженность симптомов', 'Умеренная выраженность симптомов', 'Тяжёлая выраженность симптомов'],
  },
};

export function scoreAssessment(scaleId, answers) {
  const scale = SCALES[scaleId];
  if (!scale || !Array.isArray(answers) || answers.length !== scale.questions.length || Array.from(answers).some(value => !Number.isInteger(value) || value < 0 || value > 3)) throw new Error('Ответьте на каждый вопрос, чтобы получить результат');
  const score = answers.reduce((sum, value) => sum + value, 0);
  const level = scale.thresholds.filter(threshold => score >= threshold).length;
  return { score, max: scale.max, level, severity: scale.levels[level], needsSafetyFollowUp: scaleId === 'phq9' && answers[8] > 0 };
}

export function makeAssessmentEntry(scaleId, answers, impact = null, now = new Date()) {
  const result = scoreAssessment(scaleId, answers);
  const needsImpact = scaleId === 'phq9' && result.score > 0;
  if (needsImpact && (!Number.isInteger(impact) || impact < 0 || impact > 3)) throw new Error('Укажите, насколько эти проблемы мешали повседневным делам');
  return { id: crypto.randomUUID(), type: 'assessment', scaleId, version: SCALES[scaleId].version, answers: [...answers], impact: needsImpact ? impact : null, ...result, day: dayKey(now), at: now.toISOString(), createdAt: now.toISOString() };
}
