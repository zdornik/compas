import {MoodTrend} from './MoodTrend.jsx';
import {medicationDraft} from './medications.js';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { House, BookOpen, CalendarBlank, ChatsCircle, Pill, ClipboardText, Plus, Moon, Check, CaretLeft, CaretRight, ArrowUpRight, GearSix, ShieldCheck, DownloadSimple, ArrowCounterClockwise, LockSimple, Bell, CheckCircle } from '@phosphor-icons/react';
import { Modal, Row, Art } from './components.jsx';
import { MoodFlow } from './MoodFlow.jsx';
import { MoodScene } from './MoodScene.jsx';
import { JournalEditor } from './JournalEditor.jsx';
import { DatePicker, DurationWheel } from './DateTimeControls.jsx';
import { Assessments } from './Assessments.jsx';
import { SCALES } from './assessments.js';
import { DiaryCalendar } from './DiaryCalendar.jsx';
import { appThemeAt } from './mood-motion.js';
import { PersistenceContext, AccountOwnersContext, loadEntry, loadStoredState, storeEntry, loadAuthAccount, authenticateAccount, signOutAccount, updateAccountConsents, setAccountOwner, authSignalRole } from './persistence.js';
import { DiaryPage, DoctorPage } from './WorkspacePages.jsx';
import { TreatmentPage } from './Treatment.jsx';
import { HomeMedicationReminders } from './HomeMedicationReminders.jsx';
import { MOODS, timeLabel, dateLabel, dayKey, latestMoodForDay, entryTimestamp } from './domain.js';
import { DoctorWorkspace } from './DoctorWorkspace.jsx';
import './doctor.css';
import { MedicalProfile, PatientConnections } from './MedicalProfile.jsx';
import {AccountGate} from './AccountGate.jsx';
import {AuthScene,homeSceneTarget} from './AuthScene.jsx';
import {loginWithRoleDiscovery} from './auth-motion.js';
import {AccountPreferences} from './AccountPreferences.jsx';
import {CareChat} from './CareChat.jsx';
import {HistoryContext,useEntryHistory,HistoryStatus} from './useEntryHistory.jsx';
import {mergeEntries} from './history-data.js';

const tabs = [{ id: 'today', name: 'Сегодня', icon: House }, { id: 'diary', name: 'Дневник', icon: BookOpen }, { id: 'treatment', name: 'Лечение', icon: CalendarBlank }, { id: 'doctor', name: 'Врач', icon: ChatsCircle }];

export function App() {
 const readRole=()=>({'#patient':'patient','#doctor':'doctor'}[window.location.hash]||null);
 const [role,setRole]=useState(readRole),[accounts,setAccounts]=useState({patient:undefined,doctor:undefined}),[guests,setGuests]=useState({patient:false,doctor:false}),[visited,setVisited]=useState({patient:false,doctor:false}),[seeds,setSeeds]=useState({}),[pendingIntake,setPendingIntake]=useState(null),[flight,setFlight]=useState(null),[accountWindow,setAccountWindow]=useState(null),[accountError,setAccountError]=useState(''),[gateLeaving,setGateLeaving]=useState(false),[workspaceEpoch,setWorkspaceEpoch]=useState({patient:0,doctor:0});
 const sharedScene=useRef(null);
 const authWorking=useRef(null),accountRequest=useRef({patient:0,doctor:0}),knownAccounts=useRef({patient:null,doctor:null});
 const allowed=id=>Boolean(accounts[id]||guests[id]);
 const workingFor=id=>authWorking.current==='all'||authWorking.current===id;
 useLayoutEffect(()=>{for(const id of ['patient','doctor'])if(accounts[id]!==undefined)setAccountOwner(id,accounts[id]?.id||'local');},[accounts]);
 const refreshAccount=async id=>{if(!id||workingFor(id))return;const n=++accountRequest.current[id];try{const result=await loadAuthAccount(id);if(n!==accountRequest.current[id]||workingFor(id))return;const nextId=result.account?.id||null,previousId=knownAccounts.current[id];if(previousId!==nextId){setGuests(old=>({...old,[id]:false}));setVisited(old=>({...old,[id]:Boolean(nextId)}));if(id==='patient'){setPendingIntake(null);setSeeds({});setFlight(null);}}knownAccounts.current[id]=nextId;setAccounts(old=>({...old,[id]:result.account}));if(result.account)setVisited(old=>({...old,[id]:true}));setAccountError('');}catch(error){if(n===accountRequest.current[id]&&!workingFor(id))setAccountError(error.message);}};

 useEffect(()=>{document.title=role==='doctor'?'Компас — кабинет врача':'Компас — забота о себе';if(role)refreshAccount(role);else{refreshAccount('patient');refreshAccount('doctor');}},[role]);
 useEffect(()=>{const sync=()=>setRole(readRole());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);
 useEffect(()=>{
  const refresh=()=>{if(document.hidden)return;if(role)refreshAccount(role);else for(const id of ['patient','doctor'])if(knownAccounts.current[id])refreshAccount(id);};
  const quarantine=id=>{if(!['patient','doctor'].includes(id)||workingFor(id))return;accountRequest.current[id]++;setVisited(old=>({...old,[id]:false}));setGuests(old=>({...old,[id]:false}));setAccounts(old=>({...old,[id]:undefined}));if(id==='patient'){setSeeds({});setPendingIntake(null);setFlight(null);}if(id===role)refreshAccount(id);};
  const mismatch=event=>quarantine(event.detail),timer=setInterval(refresh,60000);
  window.addEventListener('focus',refresh);window.addEventListener('compass-account-mismatch',mismatch);
  const channel='BroadcastChannel' in window?new BroadcastChannel('compass-local-updates'):null;
  if(channel)channel.onmessage=event=>{if(event.data==='changed')refresh();else{const id=authSignalRole(event.data);if(id)quarantine(id);}};
  return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('compass-account-mismatch',mismatch);channel?.close();};
 },[role]);

 const chooseRole=next=>{setRole(next);setGateLeaving(false);setFlight(null);setAccountWindow(null);setAccountError('');window.location.hash=next||'';window.scrollTo({top:0,behavior:'instant'});};
 const useGuest=async()=>{
  const id=role||'patient';let state=null;authWorking.current=id;
  try{if(id==='patient')state=await loadStoredState();}catch(error){setAccountError(error.message);authWorking.current=null;return;}
  setGateLeaving(true);if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,180));
  if(id==='patient'){setSeeds(old=>({...old,local:state}));setFlight({to:null,value:latestMoodForDay(state?.entries||[])?.value??3});}
  setWorkspaceEpoch(old=>({...old,[id]:old[id]+1}));setGuests(old=>({...old,[id]:true}));setVisited(old=>({...old,[id]:true}));setRole(id);window.location.hash=id;window.scrollTo({top:0,behavior:'instant'});authWorking.current=null;
 };
 const authenticate=async(mode,input)=>{
  const roles=mode==='login'?['patient','doctor']:[input.role];for(const id of roles)accountRequest.current[id]++;
  authWorking.current=mode==='login'?'all':input.role;
  try{return mode==='login'?await loginWithRoleDiscovery(input,value=>authenticateAccount('login',value)):await authenticateAccount(mode,input);}catch(error){authWorking.current=null;throw error;}
 };
 const authenticated=async(result,meta)=>{
  let initialState=null,intake=null;
  if(meta.role==='patient'){
   try{initialState=await loadStoredState(result.account.id);}catch(error){if(error.code==='ACCOUNT_CHANGED'||error.status===401){authWorking.current=null;await refreshAccount(meta.role);return;}}
   if(meta.medicalProfile.medications.length||meta.medicalProfile.conditions.length){
    const draft={id:'medical-profile',type:'medical-profile',expectedRevision:0,...meta.medicalProfile};
    try{const saved=await storeEntry(draft,result.account.id);if(initialState)initialState={...initialState,entries:[saved,...initialState.entries.filter(row=>row.id!=='medical-profile')]};}catch(error){if(error.code==='ACCOUNT_CHANGED'||error.status===401){authWorking.current=null;await refreshAccount(meta.role);return;}intake=draft;}
   }
   setPendingIntake(intake?{accountId:result.account.id,entry:intake}:null);setSeeds(old=>({...old,[result.account.id]:initialState}));

  }
  setGateLeaving(true);
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,180));
  if(meta.role==='patient'&&meta.sourceScene)setFlight({to:null,value:latestMoodForDay(initialState?.entries||[])?.value??3});
  setWorkspaceEpoch(old=>({...old,[meta.role]:old[meta.role]+1}));
  setRole(meta.role);window.location.hash=meta.role;
  knownAccounts.current[meta.role]=result.account.id;accountRequest.current[meta.role]++;setAccounts(old=>({...old,[meta.role]:result.account}));setGuests(old=>({...old,[meta.role]:false}));setVisited(old=>({...old,[meta.role]:true}));authWorking.current=null;window.scrollTo({top:0,behavior:'instant'});
 };
 useLayoutEffect(()=>{
  if(!flight||role!=='patient')return;
  let frame,active=true;const began=performance.now();
  const measure=()=>{if(!active)return;const scene=document.querySelector('.auth-arrival .home-hero .mood-scene');
   if(scene&&scene.clientWidth){const next=homeSceneTarget(scene,flight.value);setFlight(old=>old&&JSON.stringify(old.to)!==JSON.stringify(next)?{...old,to:next}:old);}
   else if(performance.now()-began<4000)frame=requestAnimationFrame(measure);else{setFlight(null);setGateLeaving(false);}
  };frame=requestAnimationFrame(measure);window.addEventListener('resize',measure);return()=>{active=false;cancelAnimationFrame(frame);window.removeEventListener('resize',measure);};
 },[flight,role]);
 const logout=async id=>{accountRequest.current[id]++;authWorking.current=id;try{await signOutAccount(id);knownAccounts.current[id]=null;setAccounts(old=>({...old,[id]:null}));setGuests(old=>({...old,[id]:false}));setVisited(old=>({...old,[id]:false}));setAccountWindow(null);setSeeds({});setPendingIntake(null);setFlight(null);setGateLeaving(false);}finally{authWorking.current=null;}};
 const updateConsents=async(id,value)=>{const result=await updateAccountConsents(value,id);setAccounts(old=>({...old,[id]:result.account||result}));return result;};
 return <AccountOwnersContext.Provider value={{patient:accounts.patient?.id||'local',doctor:accounts.doctor?.id||'local'}}>
  {(!role||!allowed(role))&&<AccountGate role={role||(accounts.doctor&&!accounts.patient?'doctor':'patient')} sceneRef={sharedScene} leaving={gateLeaving} onBack={()=>chooseRole(null)} onGuest={accounts[role||'patient']===null?useGuest:undefined} onLogin={input=>authenticate('login',input)} onRegister={input=>authenticate('register',input)} onAuthenticated={authenticated}/>}
  {accountError&&(!role||!allowed(role))&&<p className="auth-connection-error" role="status">{accountError}</p>}
  {visited.patient&&<div className={flight?'auth-arrival':''} hidden={role!=='patient'||!allowed('patient')} inert={role!=='patient'||!allowed('patient')||Boolean(flight)}><PatientApp key={(accounts.patient?.id||'local')+':'+workspaceEpoch.patient} initialState={seeds[accounts.patient?.id||'local']} pendingIntake={pendingIntake&&pendingIntake.accountId===accounts.patient?.id?pendingIntake.entry:null} onIntakeSaved={()=>setPendingIntake(null)} account={accounts.patient} onUpdateConsents={value=>updateConsents('patient',value)} onSignOut={()=>logout('patient')} onRequestAuth={()=>setGuests(old=>({...old,patient:false}))} active={role==='patient'&&allowed('patient')} onSwitchRole={()=>chooseRole(null)}/></div>}
  {visited.doctor&&<div hidden={role!=='doctor'||!allowed('doctor')} inert={role!=='doctor'||!allowed('doctor')}><DoctorWorkspace key={(accounts.doctor?.id||'local')+':'+workspaceEpoch.doctor} account={accounts.doctor} onAccount={()=>accounts.doctor?setAccountWindow('doctor'):setGuests(old=>({...old,doctor:false}))} active={role==='doctor'&&allowed('doctor')} onSwitchRole={()=>chooseRole(null)}/></div>}
  {(!role||!allowed(role)||flight)&&<AuthScene ref={sharedScene} target={flight?.to} onArrive={()=>{setFlight(null);setGateLeaving(false);}}/>}
  {accountWindow&&accounts[accountWindow]&&<Modal title="Учётная запись" onClose={()=>setAccountWindow(null)}><div className="modal-body settings-body"><AccountPreferences account={accounts[accountWindow]} onUpdate={value=>updateConsents(accountWindow,value)} onSignOut={()=>logout(accountWindow)}/></div></Modal>}
 </AccountOwnersContext.Provider>;
}

function PatientApp({ active, onSwitchRole, account, onUpdateConsents, onSignOut, onRequestAuth,initialState,pendingIntake,onIntakeSaved }) {
  const [page, setPage] = useState('today');
  const [moodPreview, setMoodPreview] = useState(null);
  const [journalDraft, setJournalDraft] = useState(null);
  const [selectedJournalId, setSelectedJournalId] = useState(null);
  const [viewingAssessment, setViewingAssessment] = useState(null);
  const [assessmentDraft,setAssessmentDraft]=useState(null);
  const sectionIndex = tabs.findIndex(tab => tab.id === page);
  const [diaryDay, setDiaryDay] = useState(dayKey);
  const [editingMood, setEditingMood] = useState(null);
  const [modal, setModal] = useState(pendingIntake?'health':null);
  const [medicalDraft,setMedicalDraft]=useState(pendingIntake);
  const [chatDrafts,setChatDrafts]=useState({});
  useEffect(() => { if (!active) { setModal(null); setMoodPreview(null); } }, [active]);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);
  const closeModal = () => {
    if (closeTimer.current) return;
    setClosing(true);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
    closeTimer.current = setTimeout(() => { setModal(null); setClosing(false); setMoodPreview(null); closeTimer.current = null; }, duration);
  };
  useEffect(() => () => { clearTimeout(closeTimer.current); }, []);
  const [entries, setEntries] = useState(initialState?.entries||[]);
  const [historyAvailable,setHistoryAvailable]=useState(Boolean(initialState?.historyAvailable));
  const stateRevision=useRef(initialState?.revision),journalRequest=useRef({sequence:0,controller:null});
  useEffect(()=>{journalRequest.current.sequence++;journalRequest.current.controller?.abort();},[active,page]);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    let timer;
    const tick = () => { setClock(new Date()); timer = setTimeout(tick, 60000 - Date.now() % 60000 + 20); };
    const refresh = () => { clearTimeout(timer); tick(); };
    const visible = () => { if (!document.hidden) refresh(); };
    timer = setTimeout(tick, 60000 - Date.now() % 60000 + 20);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const [storage, setStorage] = useState(initialState?'ready':'loading');
  const refreshRevision = useRef(0), mutationRevision = useRef(0), receivedPlans=useRef(null);
  useEffect(() => {
    if(!active)return;
    let alive = true;
    let lastRefresh = 0;
    const refresh = async force => {
      if (force !== true && Date.now() - lastRefresh < 1000) return;
      lastRefresh = Date.now();
      const request = ++refreshRevision.current, revision = mutationRevision.current;
      try {
        const state = await loadStoredState(undefined,stateRevision.current);
        if (alive && request === refreshRevision.current && revision === mutationRevision.current) {
          setStorage('ready');if(state.unchanged)return;
          stateRevision.current=state.revision;setHistoryAvailable(Boolean(state.historyAvailable));
          const delivered=state.entries.filter(entry=>entry.type==='medication-plan'&&entry.origin==='doctor');
          if(receivedPlans.current&&delivered.some(entry=>receivedPlans.current.get(entry.id)!==entry.revision))setToast('Врач обновил ваш план лечения');
          receivedPlans.current=new Map(delivered.map(entry=>[entry.id,entry.revision]));
          setEntries(state.entries); setStorage('ready');
        }
      } catch { if (alive && request === refreshRevision.current) setStorage('offline'); }
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('compass-local-updates') : null;
    if (channel) channel.onmessage = event => { if (event.data === 'changed') refresh(true); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    refresh();
    const timer=setInterval(()=>{if(!document.hidden)refresh();},15000);
    return () => { alive = false; clearInterval(timer); channel?.close(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [active]);
  const [toast, setToast] = useState(pendingIntake?'Аккаунт создан. Медицинские сведения оставлены в черновике — сохраните их после подключения.':'');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const ready = e => { e.preventDefault(); setInstallPrompt(e); };
    const done = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', done); };
  }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); } }, [toast]);
  const latest = latestMoodForDay(entries);
  const mood = MOODS[latest?.value ?? 3];
  const themePosition = moodPreview ?? latest?.value ?? 3;
  const navigate = next => {
    if (next === page) return;
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const openSectionModal = type => { if (type === 'questionnaire') setViewingAssessment(null); setModal(type); };
  const openJournal = async (entry = null, date = dayKey()) => {
    const current=journalRequest.current;current.controller?.abort();current.controller=new AbortController();const sequence=++current.sequence;
    if(entry&&entry.body===undefined){
      try{entry=await loadEntry(entry.id,current.controller.signal);if(sequence!==current.sequence)return;}
      catch(error){if(sequence===current.sequence&&!current.controller.signal.aborted)setToast(error.message);return;}
    }
    if (entry) setJournalDraft(old => old?.id === entry.id ? old : { ...entry, date: entry.day || dayKey(new Date(entry.at)) });
    else setJournalDraft(old => old && !old.id ? old : { title: '', body: '', date, clientId: crypto.randomUUID() });
    setModal('journal');
  };
  const openMood = (entry = null) => { setEditingMood(entry); setModal('mood'); };
  const save = async entry => {
    if (storage !== 'ready') throw new Error('База недоступна. Запись остаётся в форме — повторите сохранение после подключения');
    mutationRevision.current++;
    const saved = await storeEntry(entry);
    setEntries(old => old.some(e => e.id === saved.id) ? old.map(e => e.id === saved.id ? (e.revision>saved.revision?e:saved) : e) : [saved, ...old]);
    if(saved.type==='journal'&&saved.currentRevision>saved.revision)return loadEntry(saved.id);
    if (page === 'diary' && ['mood', 'sleep', 'assessment', 'journal'].includes(saved.type)) setDiaryDay(saved.day || dayKey(new Date(saved.at)));
    return saved;
  };
  const reloadState = async () => {
    const state = await loadStoredState();
    refreshRevision.current++; stateRevision.current=state.revision;setHistoryAvailable(Boolean(state.historyAvailable));setEntries(state.entries); setStorage('ready'); return state;
  };
  return <HistoryContext.Provider value={historyAvailable}><PersistenceContext.Provider value={storage === 'ready'}><div className={`app tone-${MOODS[Math.round(themePosition)].tone} ${closing ? 'closing' : ''}`} style={{ ...appThemeAt(themePosition), '--section-index': sectionIndex }}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Перейти к содержимому</a>
    <aside className="sidebar">
      <div className="wordmark">компас<span className="wordmark-dot"/></div><div className="sidebar-caption">Пространство заботы о себе</div>
      <nav aria-label="Основная навигация"><span className="sidebar-glider" aria-hidden="true"/>{tabs.map(({ id, name, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={page === id ? 'current' : ''} aria-current={page === id ? 'page' : undefined}><Icon size={23} weight={page === id ? 'duotone' : 'regular'}/><span>{name}</span></button>)}</nav>
      <div className="sidebar-bottom"><button className="sidebar-setting" onClick={onSwitchRole}><ArrowCounterClockwise size={21}/>Сменить аккаунт</button><button className="sidebar-setting" onClick={() => setModal('settings')}><GearSix size={21}/>Настройки и приватность</button><p><span className="demo-dot"/>Локальный прототип</p><small>Только вымышленные данные.<br/>{storage === 'ready' ? 'Записи в локальной базе.' : storage === 'loading' ? 'Подключаем хранилище…' : 'База недоступна. Сохранение отключено.'}</small></div>
    </aside>
    <main tabIndex={-1} id="main-content" className="main" aria-busy={storage === 'loading'}>
      <button className="patient-role-switch" onClick={onSwitchRole}>Пациент <ArrowCounterClockwise size={15}/></button>
      {storage === 'offline' && <div className="storage-error" role="status">Хранилище недоступно. Записи пока нельзя сохранить.<button onClick={() => { setStorage('loading'); loadStoredState().then(state => { setEntries(state.entries); setStorage('ready'); }).catch(() => setStorage('offline')); }}>Подключить снова</button></div>}
      <div className="page-window">{tabs.map(tab => <section key={tab.id} className={`page-pane page-${tab.id} ${page === tab.id ? 'active' : ''}`} inert={page !== tab.id} aria-hidden={page !== tab.id} aria-label={tab.name}>
        {tab.id === 'today' ? <>
        <section className="home-hero">
          <MoodScene value={themePosition}/>
          <div className="hero-inner"><h1>Сегодня</h1><div className="hero-state"><h2>{mood.short}</h2><p>Последняя отметка<br/>{latest ? timeLabel(latest.at) : 'Пока нет отметки'}</p></div>
            <button className="mascot-target" aria-label="Оценить настроение, нажав на маскота" onClick={() => openMood()}/>
            <button className="mood-cta" onClick={() => openMood()}>Отметить настроение<Plus size={25}/></button>
          </div>
        </section>
        <section className="today-section content-width"><div className="section-heading"><h2>На сегодня</h2><span className="desktop-only quiet">В своём ритме</span></div><div className="reminder-group">
          <HomeMedicationReminders entries={entries} now={clock} onOpen={() => navigate('treatment')} onSave={save} onReload={reloadState} onToast={setToast}/>
          <Row icon={Moon} title="Как вы спали?" subtitle="Ежедневная отметка длительности и качества" onClick={() => openSectionModal('sleep')}/><Row icon={ClipboardText} title="Опросники самочувствия" subtitle="Депрессия и тревожность · PHQ-9 и GAD-7" end="3 мин" onClick={() => openSectionModal('questionnaire')}/>
        </div><button className="mobile-info" onClick={() => setModal('settings')}>Локальный прототип · о данных и приложении</button></section>
        </> : <div className="page-content content-width workspace-page">
          <header className="page-header"><div><p className="eyebrow desktop-only">ЛИЧНОЕ ПРОСТРАНСТВО</p><h1>{tab.name}</h1></div></header>
          {tab.id === 'diary' && <DiaryPage active={active&&page==='diary'} entries={entries} selectedId={selectedJournalId} onSelect={setSelectedJournalId} onNew={() => openJournal()} onAdd={date => { if (date) setDiaryDay(date); setModal('add'); }} onEdit={openJournal} hasDraft={Boolean(journalDraft && !journalDraft.id && journalDraft.body.trim())}><MoodHistory entries={entries.filter(entry => ['mood', 'sleep', 'assessment'].includes(entry.type))} selected={diaryDay} setSelected={setDiaryDay} onEdit={openMood} onAssessment={entry => { setViewingAssessment(entry); setModal('questionnaire'); }} onAdd={() => setModal('add')}/></DiaryPage>}
          {tab.id === 'treatment' && <TreatmentPage active={active&&page==='treatment'} entries={entries} themeValue={themePosition} now={clock} onOpen={openSectionModal} onSave={save} onReload={reloadState} onToast={setToast}/>}
          {tab.id === 'doctor' && <DoctorPage owner={account?.id} active={active&&page==='doctor'} onRequestAuth={onRequestAuth} onOpen={setModal} onNavigate={navigate}><PatientConnections active={active&&page==='doctor'} account={account} onUpdateConsents={onUpdateConsents} onRequestAuth={onRequestAuth} onHealth={()=>setModal('health')}/></DoctorPage>}
        </div>}
      </section>)}</div>
    </main>
    <nav className="bottom-nav" aria-label="Навигация по приложению"><span className="bottom-nav-glider" aria-hidden="true"/>{tabs.map(({ id, name, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={page === id ? 'current' : ''} aria-current={page === id ? 'page' : undefined}><Icon size={24}/><span>{name}</span></button>)}</nav>
    {toast && <div role="status" className="toast"><CheckCircle size={20}/>{toast}</div>}
    {modal === 'journal' && journalDraft && <JournalEditor onReload={async()=>{const latest=await loadEntry(journalDraft.id);setJournalDraft({...latest,date:latest.day});}} draft={journalDraft} onChange={setJournalDraft} onClose={closeModal} onSave={async entry => { const saved = await save(entry); setSelectedJournalId(saved.id); setJournalDraft({ ...saved, date: saved.day }); closeModal(); setToast('Запись сохранена в дневнике'); }}/>}
    {modal === 'mood' && <MoodFlow initialEntry={editingMood} initialDate={page === 'diary' ? diaryDay : dayKey()} onPreview={(editingMood?.day || (editingMood ? dayKey(new Date(editingMood.at)) : page === 'diary' ? diaryDay : dayKey())) === dayKey() ? setMoodPreview : undefined} onClose={() => closeModal()} onSave={save}/>}
    {modal === 'questionnaire' && <Assessments draft={assessmentDraft} onDraftChange={setAssessmentDraft} moodValue={themePosition} initialEntry={viewingAssessment} entries={entries} onClose={closeModal} onSave={async entry => { const saved = await save(entry); setToast('Результат сохранён в дневнике'); return saved; }}/ >}
    {modal === 'sleep' && <Sleep entries={entries} initialDate={page === 'diary' ? diaryDay : dayKey()} onClose={() => closeModal()} onSave={async entry => { await save(entry); closeModal(); setToast('Сон отмечен в дневнике'); }}/ >}
    {modal === 'add' && <Modal title="Добавить в дневник" className="diary-add-modal" onClose={() => closeModal()}><div className="modal-body"><Row icon={Plus} title="Состояние" subtitle={`За ${dateLabel(`${diaryDay}T12:00:00+03:00`)}`} onClick={() => openMood()}/><Row icon={Moon} title="Сон" subtitle="Длительность и качество отдыха" onClick={() => setModal('sleep')}/><Row icon={ClipboardText} title="Пройти опросник" subtitle="PHQ-9 и GAD-7 · отметка за сегодня" onClick={() => openSectionModal('questionnaire')}/></div></Modal>}
    {modal === 'settings' && <Settings account={account} onUpdateConsents={onUpdateConsents} onSignOut={onSignOut} onRequestAuth={onRequestAuth} onHealth={()=>setModal('health')} installed={installed} installPrompt={installPrompt} onClose={() => closeModal()} onInstall={async () => { await installPrompt.prompt(); const result = await installPrompt.userChoice; setInstallPrompt(null); if (result.outcome === 'accepted') setInstalled(true); }}/ >}
    {modal==='health'&&<MedicalProfile entries={entries} onArchivePlan={plan=>save({...medicationDraft(plan),type:'medication-plan',archived:true})} profile={entries.find(entry=>entry.type==='medical-profile')} draft={medicalDraft} onChange={setMedicalDraft} onSave={async value=>{const saved=await save(value);onIntakeSaved?.();return saved;}} storageReady={storage==='ready'} onClose={closeModal}/>}
    {modal==='chat'&&<Modal title="Сообщения" className="patient-chat-modal" onClose={closeModal}><div className="modal-body"><CareChat role="patient" drafts={chatDrafts} onDraftsChange={setChatDrafts} active={active} onManageConnections={()=>{setModal(null);setPage('doctor');}}/></div></Modal>}
    {['change-doctor', 'appointment', 'recommendations'].includes(modal) && <Unavailable type={modal} onClose={() => closeModal()}/>}
  </div></PersistenceContext.Provider></HistoryContext.Provider>;
}

function MoodHistory({ entries:localEntries, active, selected, setSelected, onAdd, onEdit, onAssessment }) {
  const today = dayKey();
  const [period,setPeriod]=useState({from:selected,to:selected});
  const onPeriodChange=useCallback(value=>setPeriod(old=>old.from===value.from&&old.to===value.to?old:value),[]);
  const history=useEntryHistory({kind:'observations',...period,active});
  const day=useEntryHistory({kind:'observations',from:selected,to:selected,active:active&&(selected<period.from||selected>period.to)});
  const entries=mergeEntries(history.entries,day.entries,localEntries);
  const filtered = entries.filter(e => (e.day || dayKey(new Date(e.at))) === selected);
  return <><HistoryStatus resource={history}/><HistoryStatus resource={day}/><MoodTrend entries={entries} from={period.from} to={period.to>today?today:period.to} selected={selected} onSelect={setSelected}/><DiaryCalendar entries={entries} selected={selected} onSelect={setSelected} onPeriodChange={onPeriodChange}/>
    <div className="section-heading"><h2>{selected === today ? 'Сегодня' : dateLabel(`${selected}T12:00:00Z`)}</h2><button className="text-button" onClick={onAdd} disabled={selected > today}>Добавить <Plus size={17}/></button></div>
    <div className="timeline">{filtered.length ? filtered.map(entry => <article className="timeline-row" key={entry.id}><time>{entry.kind === 'day' ? 'За день' : timeLabel(entry.at)}</time><div className="timeline-dot"/><div className="entry surface"><div className="entry-title">{entry.type === 'mood' ? <><Art tone={MOODS[entry.value].tone} className="entry-orb"/><h3>{MOODS[entry.value].short}</h3></> : entry.type === 'assessment' ? <><ClipboardText size={23}/><h3>{SCALES[entry.scaleId].name} · {entry.score} из {entry.max}</h3></> : <><Moon size={23}/><h3>Сон · {entry.hours} ч {entry.minutes} мин</h3></>}{entry.sample && <span className="sample-label">пример</span>}</div>{entry.type === 'mood' && <small className="secondary">{entry.kind === 'day' ? 'Состояние за день' : 'Состояние в моменте'}</small>}{entry.note && <p className="entry-note">{entry.note}</p>}{entry.type === 'sleep' && <p className="secondary">Качество сна: {entry.quality.toLowerCase()}</p>}{entry.type === 'assessment' && <><p className="secondary">{entry.severity}</p><button className="text-button edit-entry" onClick={() => onAssessment(entry)}>Открыть результат</button></>}{entry.words?.length > 0 && <div className="entry-tags">{entry.words.map(word => <span key={word}>{word}</span>)}</div>}{entry.factors?.length > 0 && <p className="entry-factors">Повлияло: {entry.factors.join(', ').toLowerCase()}</p>}{entry.type === 'mood' && <button className="text-button edit-entry" onClick={() => onEdit(entry)}>Изменить отметку</button>}</div></article>) : <div className="empty-state"><BookOpen size={32}/><h3>Пока нет отметок</h3><p>Здесь будут настроение, сон и результаты опросников.</p><button className="text-button" onClick={onAdd} disabled={selected > today}>Добавить отметку <Plus size={17}/></button></div>}</div>
    <p className="page-footnote">Записи сохраняются в локальной базе. Доступ подключённого врача к личным текстам настраивается отдельно.</p>
  </>;
}

function Sleep({ initialDate, entries, onClose, onSave }) {
 const [date,setDate]=useState(initialDate);
 return <Modal title="Как вы спали?" className="sleep-modal" onClose={onClose}><SleepDay key={date} date={date} entries={entries} onDate={setDate} onSave={onSave}/></Modal>;
}
function SleepDay({date,entries:localEntries,onDate,onSave}) {
 const history=useEntryHistory({kind:'observations',from:date,to:date});
 const entries=mergeEntries(history.entries,localEntries),[record,setRecord]=useState(null),initialized=useRef(false),entryId=useRef(crypto.randomUUID());
 const [duration,setDuration]=useState({hours:7,minutes:0}),[quality,setQuality]=useState('Хорошо'),[note,setNote]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const loadCurrent=()=>{const row=entries.filter(e=>e.type==='sleep'&&e.day===date).sort((a,b)=>(b.updatedAt||b.at).localeCompare(a.updatedAt||a.at))[0];setRecord(row||null);setDuration(row?{hours:row.hours,minutes:row.minutes}:{hours:7,minutes:0});setQuality(row?.quality||'Хорошо');setNote(row?.note||'');setError('');};
 useEffect(()=>{if(initialized.current||(history.enabled&&(!history.data||history.loading)))return;initialized.current=true;loadCurrent();},[history.data,history.loading,history.enabled]);
 return <form className="modal-body" onSubmit={async event=>{event.preventDefault();if(pending||!initialized.current)return;if(duration.hours*60+duration.minutes===0){setError('Укажите длительность сна больше нуля');return;}setPending(true);try{await onSave({id:record?.id||entryId.current,type:'sleep',...duration,quality,note,day:date,expectedUpdatedAt:record?.updatedAt});}catch(e){setError(e.message);}finally{setPending(false);}}}>
 <p className="secondary">Ежедневная самооценка сна: длительность, качество и при желании комментарий в дневнике.</p><DatePicker label="Дата сна" value={date} onChange={value=>{if(!pending)onDate(value);}}/><HistoryStatus resource={history}/>
 <DurationWheel {...duration} onChange={(hours,minutes)=>{setDuration({hours,minutes});setError('');}}/><fieldset className="sleep-quality" disabled={pending}><legend>Как вы выспались?</legend><div>{['Плохо','Не очень','Нормально','Хорошо','Отлично'].map(value=><label key={value} className={quality===value?'selected':''}><input type="radio" name="sleep-quality" value={value} checked={quality===value} onChange={()=>setQuality(value)}/><span>{value}</span></label>)}</div></fieldset>
 <label className="med-field"><span>Комментарий в дневник · по желанию</span><textarea aria-label="Комментарий в дневник · по желанию" rows={3} maxLength={2000} value={note} disabled={pending} onChange={e=>setNote(e.target.value)} placeholder="Что повлияло на ваш сон?"/></label>
 {error&&<p className="journal-error" role="alert">{error}</p>}{error&&<button type="button" className="text-button" onClick={async()=>{await history.reload();initialized.current=false;}}>Загрузить актуальную запись вместо черновика</button>}
 <p className="input-hint">{record?'Вы изменяете сохранённую отметку за этот день.':'Сон сохраняется в дневник.'} Комментарий доступен врачу только при разрешении на личные тексты.</p><button className="primary full-width" type="submit" disabled={pending||history.loading||Boolean(history.error)||!initialized.current}>{pending?'Сохраняем…':record?'Обновить отметку':'Сохранить'}</button></form>;
}

function Settings({ installed, installPrompt, onInstall, onClose, onHealth,account,onUpdateConsents,onSignOut,onRequestAuth }) {
  return <Modal title="О приложении и данных" onClose={onClose}><div className="modal-body settings-body"><div className="settings-intro"><LockSimple size={27}/><h3>Личное остаётся личным</h3></div><p className="secondary">Это интерактивная демоверсия. Пожалуйста, используйте только вымышленные сведения.</p><section>{account?<AccountPreferences key={account.id} account={account} onUpdate={onUpdateConsents} onSignOut={onSignOut}/>:<><h3>Локальный профиль</h3><p>Регистрация создаст отдельную учётную запись. Эти записи останутся в локальном профиле этого браузера.</p><button className="secondary-button" onClick={onRequestAuth}>Войти или зарегистрироваться</button></>}</section><section><h3>Сведения для врача</h3><p>Принимаемые препараты и личные медицинские сведения можно добавить, исправить или убрать здесь.</p><button className="secondary-button" onClick={onHealth}>Управлять сведениями</button></section><section><h3>Где находятся записи</h3><p>Сохранённые записи и отметки находятся в локальной базе PostgreSQL. Обновление страницы их не удаляет. Доступ к вашему локальному профилю хранится в защищённой от чтения скриптами cookie этого браузера. Без регистрации другой браузер открывает отдельный локальный профиль. В учётную запись можно войти по почте и паролю. Аналитика и внешние шрифты не подключены.</p></section><section><h3>Добавить на главный экран</h3>{installed || window.matchMedia('(display-mode: standalone)').matches ? <p>Приложение установлено или уже открыто отдельно.</p> : <><p>На iPhone откройте сайт в Safari, нажмите «Поделиться», затем «На экран Домой». На компьютере и Android используйте установку в меню браузера.</p>{installPrompt && <button className="secondary-button" onClick={onInstall}><DownloadSimple size={20}/>Установить приложение</button>}</>}</section><section><h3>Уведомления</h3><p>Фоновые напоминания пока не подключены. В рабочей версии они будут приходить без названий лекарств и медицинских подробностей на экране блокировки.</p></section><button className="primary full-width" onClick={onClose}>Понятно</button></div></Modal>;
}

function Unavailable({ type, onClose }) {
  const content = {
    health: ['Медицинский профиль', 'Препараты, хронические заболевания и аллергии появятся после подключения защищённого профиля пациента. Проверка взаимодействий потребует проверенной лекарственной базы и участия врача.'],
    'change-doctor': ['Смена специалиста', 'Переход к другому врачу будет оформляться с вашим согласием на доступ к данным. Новый доступ и отзыв прежнего должны проверяться на сервере. В демоверсии врач не меняется.'],
    chat: ['Переписка с врачом', 'Защищённый чат пока не подключён. Здесь нельзя отправить сообщение. На следующем этапе добавим переписку, статусы доставки и понятные часы ответа.'],
    appointment: ['Запись на приём', 'Календарь ещё не подключён. Здесь появятся согласованное время приёма и возможность открыть его подробности.'],
    recommendations: ['Рекомендации врача', 'Здесь появится обратная связь вашего врача. Автоматические медицинские рекомендации в прототипе не генерируются.'],
  };
  return <Modal title={content[type][0]} onClose={onClose}><div className="modal-body"><p className="pill-label inline">Следующий этап</p><p className="secondary readable">{content[type][1]}</p><button className="primary full-width" onClick={onClose}>Понятно</button></div></Modal>;
}
