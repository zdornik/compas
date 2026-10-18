import {useLayoutEffect,useRef,useState} from 'react';

// Measure natural content independently from the scroll viewport, so shrinking
// a fixed-height dialog never measures its own previous stretched height.
export function useMeasuredDialog() {
 const content=useRef(null),footer=useRef(null),[height,setHeight]=useState(null),[ready,setReady]=useState(false);
 useLayoutEffect(()=>{
  const dialog=content.current?.closest('dialog'),header=dialog?.querySelector('.modal-header');
  const measure=()=>{
   if(!dialog||!content.current||!footer.current)return;
   const inset=matchMedia('(max-width:760px)').matches?12:32;
   const available=Math.max(200,(window.visualViewport?.height||window.innerHeight)-inset);
   const natural=content.current.getBoundingClientRect().height+footer.current.getBoundingClientRect().height+(header?.getBoundingClientRect().height||0)+2;
   setHeight(Math.min(Math.ceil(natural),available));
  };
  const observer=new ResizeObserver(measure);
  for(const element of [content.current,footer.current,header])if(element)observer.observe(element);
  measure();const frame=requestAnimationFrame(()=>setReady(true));
  window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);};
 },[]);
 return {content,footer,style:height===null?undefined:{height},ready};
}
