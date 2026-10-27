import {useEntryHistory,HistoryStatus} from './useEntryHistory.jsx';
import {mergeEntries} from './history-data.js';
import {addDays} from './medications.js';
import {dayKey} from './domain.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CaretDown, Check, HandHeart, ListChecks, FileText, ShieldCheck } from '@phosphor-icons/react';
import { Modal } from './components.jsx';
import { ANSWER_OPTIONS, IMPACT_OPTIONS, SCALES, scoreAssessment, makeAssessmentEntry } from './assessments.js';
import { dateLabel } from './domain.js';
import { AssessmentEnvironment } from './AssessmentEnvironment.jsx';
import { usePersistentStorage } from './persistence.js';

function SupportNotice() {
  return <aside className="assessment-support" role="note"><div className="assessment-support-heading"><HandHeart size={22}/><h3>С этим важно не оставаться одному</h3></div><p>Вы отметили мысли о смерти или причинении себе вреда. Пожалуйста, как можно скорее свяжитесь со специалистом и расскажите о них, независимо от общего балла.</p><p>Если есть опасность причинить себе вред прямо сейчас, обратитесь в местную экстренную службу или ближайшее отделение неотложной помощи. По возможности попросите близкого человека побыть рядом.</p><small>Приложение не отправляет тревожный сигнал и не уведомляет врача.</small></aside>;
}

export function AssessmentResult({ entry, children, artSlot }) {
  const scale = SCALES[entry.scaleId];
  // Always derive the display from answers; never trust a stale stored total.
  const result = scoreAssessment(entry.scaleId, entry.answers);
  return <div className="assessment-result">
    <div className="assessment-result-art" ref={artSlot}><div className="assessment-score"><span>{result.score}</span><small>из {result.max}<br/>баллов</small></div></div>
    <span className="assessment-result-name">{scale.title}</span><h3>{result.severity}</h3>
    <p className="assessment-explanation">Скрининг не ставит диагноз. Обсудите результат со специалистом, особенно если симптомы мешают вам в жизни.</p>
    {result.needsSafetyFollowUp && <SupportNotice/>}{children}
    <details className="assessment-details">
      <summary><ListChecks size={21}/><span>Ваши ответы</span><small>{scale.questions.length}</small><CaretDown className="assessment-details-chevron" size={17}/></summary>
      <ol>{scale.questions.map((question, i) => <li key={question}><span className="assessment-answer-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><div><p>{question}</p><strong>{ANSWER_OPTIONS[entry.answers[i]]}</strong></div></li>)}</ol>
      {entry.impact !== null && entry.impact !== undefined && <div className="assessment-impact-answer"><span>Влияние на повседневные дела</span><strong>{IMPACT_OPTIONS[entry.impact]}</strong></div>}
    </details>
    <a className="assessment-source-link" href={scale.source} target="_blank" rel="noopener noreferrer"><FileText size={20}/><span><strong>Оригинальная шкала {scale.name}</strong><small>Русская форма · PDF</small></span><ArrowUpRight size={17}/></a>
  </div>;
}

export function Assessments({ entries:localEntries, initialEntry, onSave, onClose, draft, onDraftChange, moodValue = 3 }) {
  const today=dayKey(),history=useEntryHistory({kind:'observations',from:addDays(today,-61),to:today,active:!initialEntry});
  const entries=mergeEntries(history.entries,localEntries).sort((a,b)=>(b.at||'').localeCompare(a.at||''));
  const [scaleId, setScaleId] = useState(initialEntry?.scaleId || draft?.scaleId || null);
  const [stage, setStage] = useState(initialEntry ? 'result' : draft?.stage || 'hub');
  const [answers, setAnswers] = useState(draft?.answers || []);
  const [question, setQuestion] = useState(draft?.question || 0);
  const [impact, setImpact] = useState(draft?.impact ?? null);
  const [result, setResult] = useState(initialEntry || draft?.result || null);
  const [saved, setSaved] = useState(Boolean(initialEntry || draft?.saved));
  useEffect(()=>{if(!initialEntry)onDraftChange?.({scaleId,stage,answers,question,impact,result,saved});},[scaleId,stage,answers,question,impact,result,saved,initialEntry,onDraftChange]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('idle');
  const [maxHeight, setMaxHeight] = useState(() => Math.min(780, window.innerHeight - (window.innerWidth <= 760 ? 16 : 32)));
  const [frameHeight, setFrameHeight] = useState(() => Math.min(560, window.innerHeight - 32));
  const [frameReady, setFrameReady] = useState(false);
  const persistent = usePersistentStorage();
  const heading = useRef(null), body = useRef(null), timer = useRef(null), moving = useRef(false);
  const artSlot = useRef(null);
  const environment = useRef(null);
  const scale = SCALES[scaleId];
  const isImpact = scale && question === scale.questions.length;
  const options = isImpact ? IMPACT_OPTIONS : ANSWER_OPTIONS;
  const answer = isImpact ? impact : answers[question];
  const busy = pending || phase !== 'idle';
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    let second;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setFrameReady(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, []);
  useLayoutEffect(() => {
    const measure = () => {
      const cap = Math.min(780, window.innerHeight - (window.innerWidth <= 760 ? 16 : 32));
      setMaxHeight(cap);
      if (stage === 'intro' || stage === 'questions') setFrameHeight(cap);
      else if (body.current) {
        const padding = getComputedStyle(body.current);
        const content = body.current.querySelector('.assessment-step').scrollHeight;
        const footer = stage === 'hub' ? 64 : 112;
        setFrameHeight(Math.min(cap, Math.ceil(66 + parseFloat(padding.paddingTop) + parseFloat(padding.paddingBottom) + content + footer)));
      }
    };
    measure();
    window.addEventListener('resize', measure);
    // Keep result details inside their initial frame; only hub content adapts.
    const observer = stage === 'hub' ? new ResizeObserver(measure) : null;
    if (observer && body.current) observer.observe(body.current.querySelector('.assessment-step'));
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [stage]);
  useLayoutEffect(() => {
    // A new page restores its scroll position while the persistent artwork
    // travels from its previous visible position, including a scrolled one.
    environment.current?.style.setProperty('--assessment-scroll-duration', moving.current ? '.52s' : '0s');
    if (body.current) body.current.scrollTop = 0;
    environment.current?.style.setProperty('--assessment-scroll-y', '0px');
    heading.current?.focus({ preventScroll: true });
  }, [stage, question]);
  const syncSceneScroll = event => {
    if (phase === 'idle') environment.current?.style.setProperty('--assessment-scroll-duration', '0s');
    environment.current?.style.setProperty('--assessment-scroll-y', `${-event.currentTarget.scrollTop}px`);
  };
  const jump = (nextStage, nextQuestion = question) => {
    if (moving.current) return;
    const apply = () => { setStage(nextStage); setQuestion(nextQuestion); };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(); return; }
    moving.current = true; setPhase('leaving');
    timer.current = setTimeout(() => {
      apply(); setPhase('entering');
      timer.current = setTimeout(() => { setPhase('idle'); moving.current = false; }, 520);
    }, 140);
  };
  const start = id => {
    setScaleId(id); setAnswers(Array(SCALES[id].questions.length).fill(null)); setImpact(null); setResult(null); setSaved(false); setError(''); jump('intro', 0);
  };
  const next = () => {
    if (busy || !Number.isInteger(answer)) return;
    if (!isImpact && question < scale.questions.length - 1) { jump('questions', question + 1); return; }
    if (!isImpact && scale.impact && answers.some(value => value > 0)) { jump('questions', scale.questions.length); return; }
    setResult(makeAssessmentEntry(scaleId, answers, impact)); jump('result');
  };
  const saveResult = async () => {
    if (saved) { onClose(); return; }
    if (pending) return;
    setPending(true); setError('');
    try { const stored = await onSave(result); setResult(stored); setSaved(true); }
    catch (error) { setError(error.message); }
    finally { setPending(false); }
  };
  const progress = stage === 'result' ? 100 : stage === 'questions' ? Math.min(100, (question + 1) / scale.questions.length * 100) : 0;
  const title = stage === 'hub' ? 'Опросники' : 'Опросник самочувствия';
  const headerProgress = ['questions', 'result'].includes(stage) && <div className="assessment-header-progress" role="progressbar" aria-label="Ход опросника" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-valuetext={stage === 'result' ? 'Опросник завершён' : isImpact ? 'Дополнительный вопрос' : `Вопрос ${question + 1} из ${scale.questions.length}`}>{scale.questions.map((_, index) => <span key={index} className={stage === 'result' || index < question ? 'complete' : index === question ? 'current' : ''}/>)}</div>;
  return <Modal title={title} headerDetail={headerProgress} style={{ height: frameHeight, '--assessment-max-height': `${maxHeight}px` }} className={`assessment-modal assessment-stage-${stage} ${frameReady ? 'frame-ready' : ''} phase-${phase}`} onClose={onClose}>
    <AssessmentEnvironment value={moodValue} stage={stage} slot={artSlot} maxHeight={maxHeight} scrollSource={body} environmentRef={environment}/>
    <div className="assessment-body" ref={body} onScroll={syncSceneScroll}><div className={`assessment-step assessment-step-${phase}`} aria-busy={busy}>
      {stage === 'hub' && <>
        <div className="assessment-hub-heading" ref={artSlot}><div className="assessment-hub-copy"><h3 ref={heading} tabIndex={-1}>Как прошли<br/>эти две недели?</h3></div></div>
        <HistoryStatus resource={history}/><p className="input-hint">Последние результаты за 62 дня. Более ранние доступны в дневнике.</p><div className="assessment-choices">{Object.values(SCALES).map(item => {
          const latest = entries.find(entry => entry.type === 'assessment' && entry.scaleId === item.id);
          return <button disabled={busy} key={item.id} className="assessment-choice" onClick={() => start(item.id)}><span className="assessment-card-top"><span className="assessment-choice-code">{item.name}</span><span className="assessment-card-count">{item.questions.length} вопросов</span></span><span className="assessment-card-copy"><strong>{item.title}</strong>{latest && <em>{latest.score} из {item.max} · {dateLabel(latest.at)}</em>}</span><span className="assessment-card-arrow"><ArrowRight size={19}/></span></button>;
        })}</div>
      </>}
      {stage === 'intro' && <>
        <div className="assessment-intro-hero" ref={artSlot}><div><h3 className="assessment-title" ref={heading} tabIndex={-1}>{scale.title}</h3></div></div>
        <p className="assessment-intro">{scale.instruction}</p>
        <p className="assessment-intro-caption">Скрининг не ставит диагноз. Результат можно сохранить и обсудить со специалистом.</p>
        <details className="assessment-about"><summary>О шкале</summary><p>{scale.questions.length} вопросов о последних двух неделях. Выберите один ответ к каждому пункту. В прототипе используйте вымышленные ответы.</p><a href={scale.source} target="_blank" rel="noopener noreferrer">Русская форма {scale.name}</a></details>
      </>}
      {stage === 'questions' && <>
        <div className="assessment-question-scene" ref={artSlot}><p className="assessment-period">{isImpact ? 'Влияние на повседневные дела · не входит в балл' : 'За последние две недели'}</p></div>
        <h3 className="assessment-question-title" ref={heading} tabIndex={-1} id="assessment-question">{isImpact ? scale.impact : scale.questions[question]}</h3>
        <fieldset className="assessment-options" disabled={busy} aria-labelledby="assessment-question">{options.map((option, index) => <label key={option} className={answer === index ? 'selected' : ''}><input type="radio" name={`assessment-${question}`} value={index} checked={answer === index} onChange={() => isImpact ? setImpact(index) : setAnswers(old => old.map((value, i) => i === question ? index : value))}/><span className="assessment-radio">{answer === index && <Check size={13} weight="bold"/>}</span><span>{option}</span></label>)}</fieldset>
        {scaleId === 'phq9' && question === 8 && answers[8] > 0 && <SupportNotice/>}
      </>}
      {stage === 'result' && result && <><h3 ref={heading} tabIndex={-1} className="assessment-result-heading">Ваш результат</h3><AssessmentResult entry={result} artSlot={artSlot}/></>}
    </div></div>
    <footer className="assessment-footer">
      {stage === 'hub' ? <p className="assessment-footer-caption"><ShieldCheck size={17}/>{persistent ? 'Результаты в дневнике доступны подключённому врачу с вашим согласием.' : 'Хранилище недоступно. Сохранение пока отключено.'}</p> : <>
        <div className="assessment-footer-actions">{stage !== 'result' && <button className="icon-button" aria-label={stage === 'intro' ? 'К выбору опросника' : 'Предыдущий вопрос'} disabled={busy} onClick={() => stage === 'intro' ? jump('hub') : question ? jump('questions', question - 1) : jump('intro')}><ArrowLeft size={20}/></button>}<button className="primary" disabled={busy || (stage === 'questions' && !Number.isInteger(answer))} onClick={stage === 'intro' ? () => jump('questions', 0) : stage === 'questions' ? next : saveResult}>{pending ? 'Сохраняем…' : stage === 'intro' ? 'Начать' : stage === 'questions' ? (isImpact || (question === scale.questions.length - 1 && !(scale.impact && answers.some(value => value > 0))) ? 'Показать результат' : 'Продолжить') : saved ? 'Готово' : 'Сохранить в дневник'}</button></div>
        <div className="assessment-footer-status">{error ? <p className="journal-error" role="alert">{error}</p> : stage === 'result' && <p>{saved ? 'Сохранено в дневнике' : 'После сохранения результат доступен подключённому врачу'}</p>}</div>
      </>}
    </footer>
  </Modal>;
}
