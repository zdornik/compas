import {useContext,useEffect,useRef,useState} from 'react';
import {AccountOwnersContext,authSignalRole} from './persistence.js';
import {pollingResources} from './polling-resource.js';

let readers=0,detach;
function listenForChanges(){
  if(readers++===0){
    const refresh=()=>pollingResources.refreshAll();
    const channel='BroadcastChannel' in window?new BroadcastChannel('compass-local-updates'):null;
    if(channel)channel.onmessage=event=>{
      const role=authSignalRole(event.data);
      if(role)pollingResources.clearRole(role);
      else if(event.data==='changed')refresh();
    };
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    detach=()=>{channel?.close();window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  }
  return ()=>{if(--readers===0)detach();};
}

export function usePollingResource({path,role='patient',owner,active=true,interval=15000,load}){
  const owners=useContext(AccountOwnersContext),id=owner??owners[role];
  const key=role+':'+id+':'+path,loader=useRef(load);loader.current=load;
  const [state,setState]=useState({key:null});
  useEffect(()=>{
    if(!active||!path||!id)return;
    const unlisten=listenForChanges();
    const unsubscribe=pollingResources.subscribe(key,signal=>loader.current(signal),value=>setState({key,...value}),interval);
    return ()=>{unsubscribe();unlisten();};
  },[key,active,interval]);
  const current=active&&state.key===key?state:{data:null,error:'',loading:Boolean(active&&path&&id)};
  return {...current,reload:()=>pollingResources.reload(key)};
}
