import {useRef,useState} from 'react';
import {ArrowRight,ArrowsClockwise,BookOpen,CalendarBlank,CaretRight,ChatCircle,GearSix,House,ShieldCheck,Stethoscope,Users} from '@phosphor-icons/react';
import {appThemeAt} from './mood-motion.js';
import {MoodScene} from './MoodScene.jsx';
import {KnowledgeLibrary} from './KnowledgeLibrary.jsx';
import {DiaryCalendar} from './DiaryCalendar.jsx';
import {dayKey,dateLabel} from './domain.js';
import {ConnectedCare} from './ConnectedCare.jsx';
import {CareChat} from './CareChat.jsx';
import './sliding-tabs.css';
const NAV = [{id:'overview',label:'Обзор',icon:House},{id:'patients',label:'Пациенты',icon:Users},{id:'calendar',label:'Календарь',icon:CalendarBlank},{id:'library',label:'Справочник',icon:BookOpen},{id:'messages',label:'Сообщения',icon:ChatCircle}];
function Wordmark(){return <div className="wordmark">компас<span className="wordmark-dot"/></div>;}
export function RoleEntry({ onChoose }) {
  return <main className="role-entry" tabIndex={-1} style={appThemeAt(3)}>
    <header className="role-header"><Wordmark/><span>Пространство заботы</span></header>
    <div className="role-layout">
      <section className="role-copy"><p className="dw-overline">РАДЫ ВАС ВИДЕТЬ</p><h1>Забота начинается<br/>с понимания.</h1><p className="role-description">О себе. О своём состоянии.<br/>О человеке по ту сторону приёма.</p>
        <div className="role-choices" aria-label="Выберите свою роль">
          <button className="role-choice" onClick={() => onChoose('patient')}><span className="role-choice-icon"><House size={25} weight="duotone"/></span><span><strong>Я пациент</strong><small>Самочувствие, дневник и лечение</small></span><ArrowRight size={22}/></button>
          <button className="role-choice" onClick={() => onChoose('doctor')}><span className="role-choice-icon"><Stethoscope size={26}/></span><span><strong>Я врач</strong><small>Пациенты, наблюдение и приёмы</small></span><ArrowRight size={22}/></button>
        </div><p className="role-caption"><ShieldCheck size={17}/>Локальная исследовательская версия</p>
      </section>
      <section className="role-art" aria-label="Маскот Компаса в спокойном зелёном окружении"><MoodScene value={3} variant="entry"/><div className="role-art-copy"><span>Рядом, чтобы замечать.</span><p>Маленькие отметки.<br/>Более полная картина.</p></div></section>
    </div><footer className="role-footer"><span>компас · бережно к каждому</span><span>Выбор роли можно изменить в любой момент</span></footer>
  </main>;
}

export function DoctorWorkspace({active,onSwitchRole,account,onAccount}) {
 const [page,setPage]=useState('overview'),[chatDrafts,setChatDrafts]=useState({}),heading=useRef(null);
 const navigate=next=>{setPage(next);window.scrollTo({top:0,behavior:'instant'});};
 return <div className="doctor-app" style={appThemeAt(3)}><a className="skip-link" href="#doctor-content" onClick={event=>{event.preventDefault();heading.current?.focus();}}>Перейти к содержимому</a><aside className="dw-sidebar"><Wordmark/><span className="dw-sidebar-caption">Кабинет врача</span><nav aria-label="Разделы кабинета врача">{NAV.map(({id,label,icon:Icon})=><button key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={22}/><span>{label}</span></button>)}</nav><div className="dw-sidebar-bottom"><div className="dw-doctor"><span className="dw-avatar dw-avatar-sage"><Stethoscope size={23}/></span><div><strong>Кабинет врача</strong><small>{account?[account.profile.name,account.profile.surname].join(' '):'Локальный профиль'}</small></div></div><button onClick={onAccount}><GearSix size={19}/>Учётная запись</button><button onClick={onSwitchRole}><ArrowsClockwise size={19}/>Сменить роль</button></div></aside><div className="dw-shell"><header className="dw-topbar"><div className="dw-breadcrumb">Кабинет врача<CaretRight size={13}/><span>{NAV.find(item=>item.id===page)?.label}</span></div><div className="dw-topbar-end"><button className="dw-icon-button" aria-label="Учётная запись" onClick={onAccount}><GearSix size={20}/></button><span className="dw-demo-note"><span/>{page==='library'?'Исследовательский справочник':'Локальные профили'}</span><button className="dw-mobile-role" onClick={onSwitchRole} aria-label="Сменить роль"><ArrowsClockwise size={20}/></button></div></header><main id="doctor-content" className="dw-main" ref={heading} tabIndex={-1}><div hidden={!['overview','patients'].includes(page)} inert={!['overview','patients'].includes(page)}><ConnectedCare active={active&&['overview','patients'].includes(page)} overview={page==='overview'}/></div>{page==='calendar'&&<CalendarPage/>}<div hidden={page!=='library'} inert={page!=='library'}><KnowledgeLibrary/></div>{page==='messages'&&<><CareChat role="doctor" drafts={chatDrafts} onDraftsChange={setChatDrafts} active={active&&page==='messages'} onManageConnections={()=>navigate('patients')}/></>}</main><footer className="dw-footer">Доступ к карте подтверждает пациент. Данные и изменения сохраняются в локальной базе.</footer></div><nav className="dw-mobile-nav" aria-label="Разделы кабинета врача на телефоне">{NAV.map(({id,label,icon:Icon})=><button key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={22}/><span>{label}</span></button>)}</nav></div>;
}


function PageHeader({eyebrow,title,description}){return <header className="dw-page-heading"><div><p className="dw-overline">{eyebrow}</p><h1>{title}</h1>{description&&<p>{description}</p>}</div></header>;}
function CalendarPage(){
 const [selected,setSelected]=useState(dayKey);
 return <><PageHeader eyebrow="РАСПИСАНИЕ" title="Календарь" description="Неделя и месяц в привычном формате."/><div className="dw-shared-calendar"><DiaryCalendar entries={[]} selected={selected} onSelect={setSelected} purpose="appointments"/><section className="surface dw-calendar-day"><span className="workspace-icon"><CalendarBlank size={25}/></span><p className="section-kicker">{dateLabel(selected+'T12:00:00Z')}</p><h2>Приёмов пока нет</h2><p className="secondary">Сохранение приёмов и уведомления пациенту ещё не подключены.</p></section></div></>;
}
