import {useRef,useState} from 'react';
import {ArrowRight,ArrowsClockwise,BookOpen,CalendarBlank,CaretRight,ChatCircle,GearSix,House,ShieldCheck,Stethoscope,Users} from '@phosphor-icons/react';
import {appThemeAt} from './mood-motion.js';
import {KnowledgeLibrary} from './KnowledgeLibrary.jsx';
import {DiaryCalendar} from './DiaryCalendar.jsx';
import {dayKey,dateLabel} from './domain.js';
import {ConnectedCare} from './ConnectedCare.jsx';
import {CareChat} from './CareChat.jsx';
import './sliding-tabs.css';
const NAV = [{id:'overview',label:'Обзор',icon:House},{id:'patients',label:'Пациенты',icon:Users},{id:'calendar',label:'Календарь',icon:CalendarBlank},{id:'library',label:'Справочник',icon:BookOpen},{id:'messages',label:'Сообщения',icon:ChatCircle}];
function Wordmark(){return <div className="wordmark">компас<span className="wordmark-dot"/></div>;}
export function DoctorWorkspace({active,onSwitchRole,account,onAccount}) {
 const [page,setPage]=useState('overview'),[chatDrafts,setChatDrafts]=useState({}),heading=useRef(null);
 const navigate=next=>{setPage(next);window.scrollTo({top:0,behavior:'instant'});};
 return <div className="doctor-app" style={appThemeAt(3)}><a className="skip-link" href="#doctor-content" onClick={event=>{event.preventDefault();heading.current?.focus();}}>Перейти к содержимому</a><aside className="dw-sidebar"><Wordmark/><span className="dw-sidebar-caption">Кабинет врача</span><nav aria-label="Разделы кабинета врача">{NAV.map(({id,label,icon:Icon})=><button key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={22}/><span>{label}</span></button>)}</nav><div className="dw-sidebar-bottom"><div className="dw-doctor"><span className="dw-avatar dw-avatar-sage"><Stethoscope size={23}/></span><div><strong>Кабинет врача</strong><small>{account?[account.profile.name,account.profile.surname].join(' '):'Локальный профиль'}</small></div></div><button onClick={onAccount}><GearSix size={19}/>Учётная запись</button><button onClick={onSwitchRole}><ArrowsClockwise size={19}/>Сменить аккаунт</button></div></aside><div className="dw-shell"><header className="dw-topbar"><div className="dw-breadcrumb">Кабинет врача<CaretRight size={13}/><span>{NAV.find(item=>item.id===page)?.label}</span></div><div className="dw-topbar-end"><button className="dw-icon-button" aria-label="Учётная запись" onClick={onAccount}><GearSix size={20}/></button><span className="dw-demo-note"><span/>{page==='library'?'Исследовательский справочник':'Локальные профили'}</span><button className="dw-mobile-role" onClick={onSwitchRole} aria-label="Сменить аккаунт"><ArrowsClockwise size={20}/></button></div></header><main id="doctor-content" className="dw-main" ref={heading} tabIndex={-1}><div hidden={!['overview','patients'].includes(page)} inert={!['overview','patients'].includes(page)}><ConnectedCare active={active&&['overview','patients'].includes(page)} overview={page==='overview'}/></div>{page==='calendar'&&<CalendarPage/>}<div hidden={page!=='library'} inert={page!=='library'}><KnowledgeLibrary/></div>{page==='messages'&&<><CareChat role="doctor" drafts={chatDrafts} onDraftsChange={setChatDrafts} active={active&&page==='messages'} onManageConnections={()=>navigate('patients')}/></>}</main><footer className="dw-footer">Доступ к карте подтверждает пациент. Данные и изменения сохраняются в локальной базе.</footer></div><nav className="dw-mobile-nav" aria-label="Разделы кабинета врача на телефоне">{NAV.map(({id,label,icon:Icon})=><button key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={22}/><span>{label}</span></button>)}</nav></div>;
}


function PageHeader({eyebrow,title,description}){return <header className="dw-page-heading"><div><p className="dw-overline">{eyebrow}</p><h1>{title}</h1>{description&&<p>{description}</p>}</div></header>;}
function CalendarPage(){
 const [selected,setSelected]=useState(dayKey);
 return <><PageHeader eyebrow="РАСПИСАНИЕ" title="Календарь" description="Неделя и месяц в привычном формате."/><div className="dw-shared-calendar"><DiaryCalendar entries={[]} selected={selected} onSelect={setSelected} purpose="appointments"/><section className="surface dw-calendar-day"><span className="workspace-icon"><CalendarBlank size={25}/></span><p className="section-kicker">{dateLabel(selected+'T12:00:00Z')}</p><h2>Приёмов пока нет</h2><p className="secondary">Сохранение приёмов и уведомления пациенту ещё не подключены.</p></section></div></>;
}
