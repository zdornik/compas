import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ChatCircleDots,ClockCounterClockwise,PaperPlaneTilt,ShieldCheck} from '@phosphor-icons/react';
import {useCareUpdates} from './MedicalProfile.jsx';
import {loadCareMessages,sendCareMessage} from './persistence.js';
import './care-chat.css';
const emptyThread=()=>({messages:[],latestIds:[],loaded:false,hasMore:false,nextBefore:null});
const mergeMessages=(current,incoming)=>[...new Map([...current,...incoming].map(row=>[row.id,row])).values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
const dayLabel=value=>new Date(value).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
const timeLabel=value=>new Date(value).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});

function CareChatPanel({role='patient',active=true,initialLinkId=null,onManageConnections,drafts:sharedDrafts,onDraftsChange}) {
 const {care,error:careError,refresh:refreshCare}=useCareUpdates(active,role);
 const links=useMemo(()=>(role==='doctor'?care?.doctorLinks:care?.patientLinks)?.filter(link=>link.status==='active')||[],[care,role]);
 const [selected,setSelected]=useState(initialLinkId),[threads,setThreads]=useState({}),[internalDrafts,setInternalDrafts]=useState({}),[error,setError]=useState(''),[pending,setPending]=useState(false),[loadingOlder,setLoadingOlder]=useState(false),[mobileThread,setMobileThread]=useState(Boolean(initialLinkId));
 const drafts=sharedDrafts||internalDrafts,setDrafts=onDraftsChange||setInternalDrafts;
 const current=links.find(link=>link.id===selected),thread=threads[selected]||emptyThread(),draft=drafts[selected]||{body:'',id:null,attempted:false};
 const selectedRef=useRef(selected),activeRef=useRef(active),scrollRef=useRef(null),nearBottom=useRef(true),prepend=useRef(null),inFlight=useRef(false);
 selectedRef.current=selected;activeRef.current=active;
 useEffect(()=>{if(initialLinkId&&links.some(link=>link.id===initialLinkId)){setSelected(initialLinkId);setMobileThread(true);}},[initialLinkId,links.map(link=>link.id).join(':')]);
 useEffect(()=>{
  if(!care)return;
  const valid=new Set(links.map(link=>link.id));
  setThreads(all=>Object.fromEntries(Object.entries(all).filter(([id])=>valid.has(id))));
  setDrafts(all=>Object.fromEntries(Object.entries(all).filter(([id])=>valid.has(id))));
  if(!valid.has(selected)){setSelected(links[0]?.id||null);setMobileThread(false);setError('');}
 },[care,role,selected]);
 useEffect(()=>{
  if(!active||!selected||!current)return;
  let alive=true,running=false;
  nearBottom.current=true;setError('');
  const poll=async()=>{
   if(!alive||running||document.hidden)return;running=true;
   try{const result=await loadCareMessages(selected,{role});if(alive){setThreads(all=>{const previous=all[selected]||emptyThread(),latestIds=result.messages.map(row=>row.id),gap=previous.loaded&&previous.latestIds?.length>0&&result.hasMore&&!previous.latestIds.some(id=>latestIds.includes(id)),reset=!previous.loaded||gap;return {...all,[selected]:{...previous,messages:mergeMessages(gap?[]:previous.messages,result.messages),latestIds,loaded:true,...(reset?{hasMore:result.hasMore,nextBefore:result.nextBefore}:{})}};});setError('');}}
   catch(problem){if(alive){setError(problem.message);if([401,403,404].includes(problem.status)){setThreads(all=>{const next={...all};delete next[selected];return next;});setDrafts(all=>{const next={...all};delete next[selected];return next;});await refreshCare();}}}
   finally{running=false;}
  };
  poll();const timer=setInterval(poll,4000);window.addEventListener('focus',poll);
  const channel='BroadcastChannel' in window?new BroadcastChannel('compass-local-updates'):null;
  if(channel)channel.onmessage=event=>{if(event.data==='changed')poll();};
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',poll);channel?.close();};
 },[active,selected,Boolean(current),role]);
 useLayoutEffect(()=>{
  const viewport=scrollRef.current;if(!viewport)return;
  if(prepend.current){viewport.scrollTop=prepend.current.top+viewport.scrollHeight-prepend.current.height;prepend.current=null;}
  else if(nearBottom.current)viewport.scrollTop=viewport.scrollHeight;
 },[selected,thread.messages.length,mobileThread]);
 const older=async()=>{
  if(loadingOlder||!thread.nextBefore)return;
  const id=selected;setLoadingOlder(true);setError('');
  try{const result=await loadCareMessages(id,{before:thread.nextBefore,role});if(selectedRef.current===id&&activeRef.current){const viewport=scrollRef.current;if(viewport)prepend.current={height:viewport.scrollHeight,top:viewport.scrollTop};setThreads(all=>({...all,[id]:{...all[id],messages:mergeMessages(all[id]?.messages||[],result.messages),hasMore:result.hasMore,nextBefore:result.nextBefore}}));}}
  catch(problem){if(selectedRef.current===id)setError(problem.message);}
  finally{setLoadingOlder(false);}
 };
 const send=async event=>{
  event?.preventDefault();if(inFlight.current||!current||!draft.body.trim())return;
  const id=selected,message={id:draft.id||crypto.randomUUID(),body:draft.body};
  inFlight.current=true;setPending(true);setError('');setDrafts(all=>({...all,[id]:{...message,attempted:true}}));
  try{const saved=await sendCareMessage(id,message,role);setThreads(all=>({...all,[id]:{...(all[id]||emptyThread()),messages:mergeMessages(all[id]?.messages||[],[saved]),loaded:true}}));setDrafts(all=>all[id]?.id===message.id?{...all,[id]:{body:'',id:null,attempted:false}}:all);if(selectedRef.current===id)nearBottom.current=true;}
  catch(problem){if(selectedRef.current===id)setError(problem.message);if([401,403,404].includes(problem.status))await refreshCare();}
  finally{inFlight.current=false;setPending(false);}
 };
 const counterpart=link=>role==='doctor'?link.patientName:link.doctorName;
 return <section className={'care-chat '+(mobileThread&&current?'is-thread-open':'')} aria-label="Переписка с подключённым специалистом">
  <header className="care-chat-page-heading"><div><p className="section-kicker">НА СВЯЗИ</p><h1>Сообщения</h1><p>Переписка с {role==='doctor'?'подключёнными пациентами':'вашим врачом'}.</p></div><ChatCircleDots size={27}/></header>
  {care&&!links.length?<div className="care-chat-empty"><ShieldCheck size={32}/><h2>{role==='doctor'?'Сначала подключите пациента':'Сначала подключите врача'}</h2><p>Чат доступен после подтверждения подключения пациентом.</p>{onManageConnections&&<button className="secondary-button" onClick={onManageConnections}>Управление подключениями</button>}</div>:<div className="care-chat-layout">
   <nav className="care-chat-people" aria-label="Собеседники">{!care?<p className="care-chat-hint" role="status">Загружаем подключения…</p>:links.map(link=><button key={link.id} className={selected===link.id?'is-selected':''} aria-current={selected===link.id?'true':undefined} onClick={()=>{setSelected(link.id);setMobileThread(true);setError('');}}><span className="care-chat-avatar">{counterpart(link)?.slice(0,1)?.toLocaleUpperCase('ru-RU')||'•'}</span><span><strong>{counterpart(link)}</strong><small>{role==='doctor'?'Пациент':'Врач'} · подключение активно</small></span><ChatCircleDots size={19}/></button>)}</nav>
   <div className="care-chat-thread">{current?<><header className="care-chat-thread-heading"><button type="button" className="icon-button care-chat-back" aria-label="К списку собеседников" onClick={()=>setMobileThread(false)}><ArrowLeft size={21}/></button><span className="care-chat-avatar">{counterpart(current)?.slice(0,1)?.toLocaleUpperCase('ru-RU')||'•'}</span><div><h2>{counterpart(current)}</h2><p>{role==='doctor'?'Подключённый пациент':'Подключённый врач'}</p></div></header>
    <div className="care-chat-history" ref={scrollRef} onScroll={event=>{const target=event.currentTarget;nearBottom.current=target.scrollHeight-target.scrollTop-target.clientHeight<90;}}>
     {thread.hasMore&&<button type="button" className="text-button care-chat-older" disabled={loadingOlder} onClick={older}><ClockCounterClockwise size={16}/>{loadingOlder?'Загружаем…':'Предыдущие сообщения'}</button>}
     {!thread.loaded?<p className="care-chat-hint" role="status">Открываем переписку…</p>:!thread.messages.length?<div className="care-chat-first-message"><ChatCircleDots size={31}/><h3>Начните разговор</h3><p>Сообщения появятся здесь после сохранения.</p></div>:<div className="care-chat-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="Сообщения переписки">{thread.messages.map((message,index)=>{const date=dayLabel(message.createdAt),previous=index?dayLabel(thread.messages[index-1].createdAt):null;return <div className="care-chat-message-group" key={message.id}>{date!==previous&&<p className="care-chat-date">{date}</p>}<article className={'care-chat-message '+(message.senderRole===role?'is-own':'')}><p>{message.body}</p><footer><span className="sr-only">{message.senderRole===role?'Вы':counterpart(current)} · </span><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></footer></article></div>;})}</div>}
    </div>
    <form className="care-chat-compose" onSubmit={send}><label className="sr-only" htmlFor={'care-chat-message-'+role}>Сообщение</label><textarea id={'care-chat-message-'+role} rows={2} maxLength={6000} placeholder="Написать сообщение…" value={draft.body} disabled={pending} onChange={event=>{const body=event.target.value;setDrafts(all=>({...all,[selected]:{body,id:all[selected]?.attempted?crypto.randomUUID():all[selected]?.id||crypto.randomUUID(),attempted:false}}));}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();send();}}}/><button type="submit" className="primary care-chat-send" aria-label={pending?'Сохраняем сообщение':'Отправить сообщение'} disabled={pending||!draft.body.trim()}><PaperPlaneTilt size={21}/><span>{pending?'Сохраняем…':'Отправить'}</span></button><p>Сообщение не является экстренным обращением. Срок ответа не гарантирован.</p></form>
   </>:<div className="care-chat-first-message"><ChatCircleDots size={34}/><h2>Выберите собеседника</h2></div>}</div>
  </div>}
  {(error||careError)&&<p className="journal-error care-chat-error" role="alert">{error||careError}</p>}
 </section>;
}

export function CareChat(props) {return <CareChatPanel key={props.role||'patient'} {...props}/>;}
