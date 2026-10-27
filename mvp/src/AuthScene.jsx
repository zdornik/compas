import {forwardRef,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';
import {ContourField} from './ContourField.jsx';
import {MascotFace} from './MascotFace.jsx';
import {moodVisualAt} from './mood-motion.js';
import {AUTH_TRAVEL_MS,entranceScene,sceneAt} from './auth-motion.js';

// Layout coordinates, never the rotated bounding box of the figure. Both the
// texture and figure use one anchor/scale throughout the shared scene.
export function homeSceneTarget(scene,value){
 const hero=scene.closest('.home-hero'),bounds=scene.getBoundingClientRect(),clip=hero.getBoundingClientRect(),figure=scene.querySelector('.mascot-figure'),style=getComputedStyle(hero);
 if(!figure)return null;
 const figureStyle=getComputedStyle(figure),point={x:bounds.left+parseFloat(figure.style.left),y:bounds.top+parseFloat(figure.style.top),width:parseFloat(figureStyle.width)};
 if(![point.x,point.y,point.width,clip.left,clip.top,clip.width,clip.height].every(Number.isFinite)||point.width<=0||clip.width<=0||clip.height<=0)return null;
 const pixels=(value,size)=>value.endsWith('%')?parseFloat(value)*size/100:parseFloat(value)||0;
 const corners=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(key=>style[key].split(' '));
 const radii=[...corners.map(parts=>pixels(parts[0],clip.width)),...corners.map(parts=>pixels(parts[1]||parts[0],clip.height))];
 return {figure:point,clip:{left:clip.left,top:clip.top,width:clip.width,height:clip.height},radii,value};
}

export const AuthScene=forwardRef(function AuthScene({target,onArrive},ref){
 const [viewport,setViewport]=useState(()=>({width:window.innerWidth,height:window.innerHeight}));
 const [pose,setPose]=useState(()=>entranceScene(window.innerWidth,window.innerHeight));
 const poseRef=useRef(pose),complete=useRef(onArrive),travel=useRef(false);complete.current=onArrive;
 useImperativeHandle(ref,()=>({snapshot:()=>poseRef.current}),[]);
 useLayoutEffect(()=>{const resize=()=>{const size={width:window.innerWidth,height:window.innerHeight};setViewport(size);if(!travel.current){const next=entranceScene(size.width,size.height);poseRef.current=next;setPose(next);}};window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 useLayoutEffect(()=>{
  if(!target)return;
  travel.current=true;const from=poseRef.current,reduced=window.matchMedia('(prefers-reduced-motion: reduce)'),began=performance.now();let frame;
  const tick=now=>{
   const raw=reduced.matches?1:Math.min(1,(now-began)/AUTH_TRAVEL_MS),t=raw*raw*(3-2*raw),next=sceneAt(from,target,t);
   poseRef.current=next;setPose(next);
   if(raw<1)frame=requestAnimationFrame(tick);else frame=requestAnimationFrame(()=>complete.current?.());
  };
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[target]);
 const visual=moodVisualAt(pose.value),radius=pose.radii.slice(0,4).map(v=>v+'px').join(' ')+' / '+pose.radii.slice(4).map(v=>v+'px').join(' ');
 return <div className={'auth-scene'+(target?' is-travelling':'')} aria-hidden="true" data-scene-x={pose.figure.x} data-scene-y={pose.figure.y} data-scene-width={pose.figure.width}>
  <div className="auth-scene-clip" style={{...pose.clip,borderRadius:radius}}><div className="auth-scene-plane" style={{left:-pose.clip.left,top:-pose.clip.top,...viewport,background:visual.background,'--head-tilt':`${visual.tilt}deg`}}>
   <ContourField value={pose.value} placement={pose.image} viewport={{left:0,top:0,...viewport}}/>
   <div className="mascot-figure" style={{left:pose.figure.x,top:pose.figure.y,width:pose.figure.width}}><div className="mascot-breath"><img className="mascot-body" src="/art/mascot-rig-v2.webp" alt="" draggable="false"/><MascotFace value={pose.value}/></div></div>
  </div></div>
 </div>;
});
