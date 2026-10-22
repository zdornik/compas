import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {readReference} from './persistence.js';
import {buildGuidelineOutline,buildInstructionOutline,formatGuidelinePage,formatInstructionPage,findGuidelineMatches} from './guidelines.js';
const emptyResults={items:[],total:0,pageCount:0,truncated:false};
const chunkStart=page=>Math.floor((page-1)/5)*5+1;
export function useReferenceReader(item,retry,enabled,initialPage,search){
 const path='/api/knowledge/documents/'+encodeURIComponent(item.id),owner=path+':'+retry;
 const [state,setState]=useState({owner,loading:true,pages:{},errors:{}}),session=useRef(null);
 const loadChunk=useCallback((current,page,force=false)=>{
  const from=chunkStart(page);if(current.loaded.has(from))return Promise.resolve();
  if(current.pending.has(from))return current.pending.get(from);
  if(!force&&current.failed.has(from))return Promise.reject(new Error('Страницы пока недоступны'));
  current.failed.delete(from);
  const request=readReference(current.path+'/reader?from='+from+'&limit=5&v='+current.index.revision,current.controller.signal).then(data=>{
   if(current.controller.signal.aborted||session.current!==current)return;
   current.loaded.add(from);setState(old=>old.owner!==current.owner?old:{...old,pages:{...old.pages,...Object.fromEntries(data.pages.map(page=>[page.page,page]))},errors:{...old.errors,[from]:null}});
  }).catch(error=>{
   if(!current.controller.signal.aborted&&session.current===current){current.failed.add(from);setState(old=>old.owner!==current.owner?old:{...old,...(error.status===409?{error:error.message}:{}),errors:{...old.errors,[from]:error.message}});}
   throw error;
  }).finally(()=>current.pending.delete(from));
  current.pending.set(from,request);return request;
 },[]);
 useEffect(()=>{
  const current={owner,path,controller:new AbortController(),index:null,loaded:new Set(),failed:new Set(),pending:new Map()};session.current=current;
  setState({owner,loading:true,pages:{},errors:{}});
  async function open(){
   try{
    let index;
    try{index=await readReference(path+'/reader-index',current.controller.signal);}
    catch(error){if(error.status!==409)throw error;const data=await readReference(path+'/reader',current.controller.signal);if(!current.controller.signal.aborted)setState({owner,loading:false,legacy:data.pages,pages:{},errors:{}});return;}
    if(current.controller.signal.aborted)return;current.index=index;setState({owner,loading:false,index,pages:{},errors:{}});
    if(enabled){const first=initialPage>1?initialPage:index.outline.find(section=>section.number==='1')?.page||index.outline[0]?.page||1;await loadChunk(current,first);}
   }catch(error){if(!current.controller.signal.aborted)setState(old=>({...old,loading:false,error:error.message}));}
  }
  open();return()=>{current.controller.abort();};
  // A mode switch preserves pages and only stops new viewport-driven requests.
 },[owner,path,loadChunk]);
 const ensurePage=useCallback((page,force=false)=>{const current=session.current;if(!current?.index||current.owner!==owner)return Promise.resolve();return loadChunk(current,page,force);},[loadChunk,owner]);
 const live=state.owner===owner?state:{owner,loading:true,pages:{},errors:{}};
 const instruction=item.kind==='drug_instruction';
 const outline=useMemo(()=>live.index?.outline||(live.legacy?(instruction?buildInstructionOutline:buildGuidelineOutline)(live.legacy):[]),[live.index,live.legacy,instruction]);
 const pages=useMemo(()=>{
  const format=instruction?formatInstructionPage:formatGuidelinePage;
  if(live.legacy)return live.legacy.map(page=>format(page,outline));
  return (live.index?.pages||[]).map(entry=>live.pages[entry.page]?{...format(live.pages[entry.page],outline),quality:entry.quality}:{...entry,text:'',blocks:[],loading:true,error:live.errors[chunkStart(entry.page)]});
 },[live.index,live.pages,live.errors,live.legacy,instruction,outline]);
 const [remote,setRemote]=useState({key:'',results:emptyResults,loading:false,error:''}),searchKey=owner+':'+live.index?.revision+':'+search;
 useEffect(()=>{
  if(!live.index||search.length<2)return;
  const controller=new AbortController();setRemote({key:searchKey,results:emptyResults,loading:true,error:''});
  readReference(path+'/reader-search?q='+encodeURIComponent(search)+'&v='+live.index.revision,controller.signal).then(results=>{if(!controller.signal.aborted)setRemote({key:searchKey,results,loading:false,error:''});}).catch(error=>{if(!controller.signal.aborted){setRemote({key:searchKey,results:emptyResults,loading:false,error:error.message});if(error.status===409)setState(old=>old.owner!==owner?old:{...old,error:error.message});}});
  return()=>controller.abort();
 },[searchKey,live.index,path,search]);
 const local=useMemo(()=>live.legacy?findGuidelineMatches(pages,search):emptyResults,[live.legacy,pages,search]);
 return {source:live,outline,pages,ensurePage,results:live.legacy?local:remote.key===searchKey?remote.results:emptyResults,searchLoading:!live.legacy&&search.length>=2&&(remote.key!==searchKey||remote.loading),searchError:remote.key===searchKey?remote.error:'',assetHashes:live.index?.assets||{},sourceHash:live.index?.sourceSha256||item.sha256};
}
