import {createContext,useContext,useEffect,useRef} from 'react';
import {AccountOwnersContext,loadEntryHistory} from './persistence.js';
import {usePollingResource} from './usePollingResource.js';
import {readHistoryWindow} from './history-data.js';
export const HistoryContext=createContext(false);

export function useEntryHistory({kind,from,to,q='',before,active=true,enabled,linkId,owner,paged=false}){
  const available=useContext(HistoryContext),owners=useContext(AccountOwnersContext);
  const role=linkId?'doctor':'patient',id=owner??owners[role];
  const params={kind,...(from?{from,to}:{}),...(q?{q}:{}),...(before?{before}:{}),limit:paged?20:100};
  const path=(linkId?'/api/care/patients/'+linkId:'/api')+'/history?'+new URLSearchParams(params);
  const key=id+':'+path,cache=useRef(null),working=active&&(enabled??available);
  useEffect(()=>()=>{cache.current=null;},[key,working]);
  const result=usePollingResource({path,role,owner:id,active:working,load:async signal=>{
    const load=(page,abort)=>loadEntryHistory({...params,...page},linkId,abort);
    const data=paged?await load({},signal):await readHistoryWindow(load,signal,cache.current?.key===key?cache.current.data:null);
    if(!signal.aborted)cache.current={key,data};return data;
  }});
  return {...result,enabled:enabled??available,entries:result.data?.entries||[]};
}

export function HistoryStatus({resource}){
  return resource.error?<p role="alert" className="journal-error">{resource.error} <button className="text-button" onClick={resource.reload}>Повторить</button></p>:resource.loading?<p role="status" className="secondary">Загружаем записи…</p>:null;
}
