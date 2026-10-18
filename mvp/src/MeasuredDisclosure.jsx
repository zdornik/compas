import {useLayoutEffect,useRef,useState} from 'react';

// Preserve a closing panel until its measured height has reached zero.
// ResizeObserver also animates changed result counts, including a capped scroll list.
export function MeasuredDisclosure({open,children,className=''}) {
 const content=useRef(null),last=useRef(children),[height,setHeight]=useState(0),[ready,setReady]=useState(false);
 if(open)last.current=children;
 useLayoutEffect(()=>{
  const measure=()=>setHeight(open?Math.ceil(content.current?.getBoundingClientRect().height||0):0);
  const observer=new ResizeObserver(measure);if(content.current)observer.observe(content.current);
  const frame=requestAnimationFrame(()=>{setReady(true);measure();});
  return()=>{observer.disconnect();cancelAnimationFrame(frame);};
 },[open]);
 return <div className={'cp-disclosure '+className+(ready?' is-ready':'')+(open?' is-open':'')} style={{height}} aria-hidden={!open} inert={!open}><div className="cp-disclosure-content" ref={content}>{open?children:last.current}</div></div>;
}
