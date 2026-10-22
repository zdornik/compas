import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CaretLeft, CaretRight, List, MagnifyingGlass, Minus, Plus, X } from '@phosphor-icons/react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdf-document.css';

export default function PdfDocument({url,initialPage=1,sourceOutline=[],onPageChange}) {
 const container=useRef(null),viewerElement=useRef(null),controls=useRef(null),searchInput=useRef(null),scaleRef=useRef('page-fit');
 const [state,setState]=useState({loading:true,error:'',pages:0}),[page,setPage]=useState(initialPage),[draft,setDraft]=useState(String(initialPage)),[query,setQuery]=useState(''),[matches,setMatches]=useState({current:0,total:0}),[pending,setPending]=useState(false),[outline,setOutline]=useState([]),[navigation,setNavigation]=useState(false),[scale,setScale]=useState('page-fit');
 useEffect(()=>{
  const abort=new AbortController();let loadingTask,viewer,pdfDocument,resizeObserver;
  (async()=>{
   const lib=await import('pdfjs-dist/build/pdf.mjs');
   lib.GlobalWorkerOptions.workerSrc=workerUrl;
   const {EventBus,PDFViewer,PDFLinkService,PDFFindController}=await import('pdfjs-dist/web/pdf_viewer.mjs');
   if(abort.signal.aborted)return;
   const eventBus=new EventBus(),links=new PDFLinkService({eventBus,externalLinkTarget:2});
   links.externalLinkEnabled=false;
   const find=new PDFFindController({eventBus,linkService:links});
   viewer=new PDFViewer({container:container.current,viewer:viewerElement.current,eventBus,linkService:links,findController:find,annotationMode:lib.AnnotationMode.ENABLE,annotationEditorMode:lib.AnnotationEditorType.NONE,enableAutoLinking:false,enablePermissions:true,abortSignal:abort.signal,maxCanvasPixels:8388608,l10n:{getLanguage:()=>Promise.resolve('ru'),getDirection:()=>Promise.resolve('ltr'),get:(_id,_args,fallback)=>Promise.resolve(fallback||''),translate:()=>Promise.resolve(),pause(){},resume(){}}});
   links.setViewer(viewer);controls.current={viewer,eventBus,links};
   resizeObserver=new ResizeObserver(()=>{if(viewer.pdfDocument&&['page-width','page-fit'].includes(scaleRef.current))viewer.currentScaleValue=scaleRef.current;});resizeObserver.observe(container.current);
   eventBus.on('pagesinit',()=>{if(abort.signal.aborted)return;viewer.currentScaleValue=scaleRef.current;viewer.currentPageNumber=Math.min(initialPage,viewer.pagesCount);setState({loading:false,error:'',pages:viewer.pagesCount});});
   eventBus.on('pagechanging',event=>{if(abort.signal.aborted)return;setPage(event.pageNumber);onPageChange?.(event.pageNumber);setDraft(String(event.pageNumber));});
   eventBus.on('updatefindmatchescount',event=>{if(!abort.signal.aborted)setMatches(event.matchesCount);});
   eventBus.on('updatefindcontrolstate',event=>{if(!abort.signal.aborted){setPending(event.state===3);setMatches(event.matchesCount||{current:0,total:0});}});
   // Parse the original PDF locally. No document scripting, remote font services or eval.
   loadingTask=lib.getDocument({url,cMapUrl:'/pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-assets/standard_fonts/',isEvalSupported:false,disableFontFace:false,useSystemFonts:false,useWasm:false,enableXfa:false,disableAutoFetch:true,disableStream:true,rangeChunkSize:65536,withCredentials:false});
   pdfDocument=await loadingTask.promise;
   if(abort.signal.aborted)return;
   viewer.setDocument(pdfDocument);links.setDocument(pdfDocument);
   const items=await pdfDocument.getOutline();
   if(!abort.signal.aborted)setOutline(items||[]);
  })().catch(error=>{if(!abort.signal.aborted)setState({loading:false,error:'Не удалось открыть PDF. Попробуйте исходный файл в отдельной вкладке.',pages:0});});
  return()=>{abort.abort();resizeObserver?.disconnect();controls.current=null;viewer?.setDocument(null);loadingTask?.destroy().catch(()=>{});};
 },[url]);
 const find=(type='',previous=false)=>{controls.current?.eventBus.dispatch('find',{source:searchInput.current,type,query,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:previous,matchDiacritics:false});};
 useEffect(()=>{if(state.loading)return;const timer=setTimeout(()=>find(),250);return()=>clearTimeout(timer);},[query,state.loading]);
 const jump=value=>{const viewer=controls.current?.viewer;if(viewer&&state.pages)viewer.currentPageNumber=Math.max(1,Math.min(state.pages,Number(value)||1));};
 const zoom=value=>{scaleRef.current=value;setScale(value);if(controls.current)controls.current.viewer.currentScaleValue=value;};
 const renderOutline=items=><ul>{items.map((item,index)=><li key={index}><button onClick={()=>{if(item.dest)controls.current?.links.goToDestination(item.dest);setNavigation(false);}}>{item.title}</button>{item.items?.length>0&&renderOutline(item.items)}</li>)}</ul>;
 return <section className="pd-document" aria-label="Просмотр оригинального PDF" onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();searchInput.current?.focus();searchInput.current?.select();}}}>
 <div className="pd-toolbar"><button className="pd-navigation-button" aria-label="Навигация по PDF" aria-expanded={navigation} onClick={()=>setNavigation(value=>!value)}><List size={19}/></button><div className="pd-pages"><button aria-label="Предыдущая страница PDF" disabled={page<=1||!state.pages} onClick={()=>jump(page-1)}><CaretLeft size={18}/></button><form onSubmit={event=>{event.preventDefault();jump(draft);}}><input aria-label="Страница PDF" type="number" min="1" max={state.pages||1} value={draft} onChange={event=>setDraft(event.target.value)}/><span>/ {state.pages||'…'}</span></form><button aria-label="Следующая страница PDF" disabled={page>=state.pages} onClick={()=>jump(page+1)}><CaretRight size={18}/></button></div><div className="pd-zoom"><button aria-label="Уменьшить PDF" disabled={!state.pages} onClick={()=>zoom(String(Math.max(.25,(controls.current?.viewer.currentScale||1)/1.2)))}><Minus size={15}/></button><select aria-label="Масштаб PDF" value={['page-width','page-fit','0.5','0.75','1','1.25','1.5','2'].includes(scale)?scale:'custom'} onChange={event=>zoom(event.target.value)}><option value="page-width">По ширине</option><option value="page-fit">Вся страница</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option><option value="custom" disabled>{Math.round(Number(scale)*100)||100}%</option></select><button aria-label="Увеличить PDF" disabled={!state.pages} onClick={()=>zoom(String(Math.min(4,(controls.current?.viewer.currentScale||1)*1.2)))}><Plus size={15}/></button></div><a href={url+'#page='+page} target="_blank" rel="noreferrer" aria-label="Открыть исходный файл PDF"><ArrowUpRight size={18}/></a></div>
 <div className="pd-find"><MagnifyingGlass size={18}/><input ref={searchInput} aria-label="Поиск в оригинальном PDF" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Найти в PDF" onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();find('again',event.shiftKey);}if(event.key==='Escape')setQuery('');}}/>{query&&<button aria-label="Очистить поиск PDF" onClick={()=>setQuery('')}><X size={15}/></button>}<span role="status">{query?(pending?'Поиск…':matches.total?`${matches.current} / ${matches.total}`:'Нет совпадений'):'Выделение текста доступно'}</span><button aria-label="Предыдущее совпадение в PDF" disabled={!query||!matches.total} onClick={()=>find('again',true)}><CaretLeft size={17}/></button><button aria-label="Следующее совпадение в PDF" disabled={!query||!matches.total} onClick={()=>find('again')}><CaretRight size={17}/></button></div>
 <div className="pd-body">{navigation&&<aside className="pd-outline" aria-label="Содержание PDF"><header><strong>Навигация</strong><button aria-label="Закрыть содержание PDF" onClick={()=>setNavigation(false)}><X size={16}/></button></header>{outline.length?renderOutline(outline):sourceOutline.length?<ul>{sourceOutline.map(section=><li key={section.id}><button onClick={()=>{jump(section.page);setNavigation(false);}}>{section.title}<small>{section.page}</small></button></li>)}</ul>:<p>В файле нет закладок. Используйте номер страницы и поиск.</p>}</aside>}<div className="pd-stage"><div className="pd-scroll" ref={container}><div ref={viewerElement} className="pdfViewer"/></div>{state.loading&&<div className="pd-overlay" role="status">Открываем оригинальный PDF…</div>}{state.error&&<div className="pd-overlay" role="alert"><p>{state.error}</p><a href={url} target="_blank" rel="noreferrer">Открыть исходный файл<ArrowUpRight size={14}/></a></div>}</div></div>
 <p className="pd-caption">Оригинальные страницы без изменения текста и таблиц. Поиск и выделение работают при наличии текстового слоя; сканы требуют распознавания.</p>
 </section>;
}
