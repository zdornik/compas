import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { contourPalette } from './mood-motion.js';
import { RADIATION, radiationFragment } from './contour-radiation.js';

const vertex = `attribute vec2 point;varying vec2 uv;void main(){uv=(point+1.0)*.5;gl_Position=vec4(point,0.,1.);}`;
const fragment = `precision highp float;varying vec2 uv;uniform sampler2D art;uniform vec2 viewport;uniform vec4 bounds;uniform vec3 innerColor;uniform vec3 outerColor;uniform float wavePhase;uniform float waveStrength;
${radiationFragment}
void main(){vec2 p=vec2(uv.x,1.-uv.y)*viewport;vec2 source=radiatingSource((p-bounds.xy)/bounds.zw);vec3 original=texture2D(art,clamp(source,0.,1.)).rgb;float shade=floor(clamp((dot(original,vec3(.2126,.7152,.0722))*255.-91.)/142.,0.,1.)*255.)/255.;vec2 outside=max(max(-source,source-1.),0.);shade=mix(shade,1.,smoothstep(0.,.32,length(outside)));gl_FragColor=vec4(mix(innerColor,outerColor,shade),1.);}`;
const ease = progress => {
  const cubic = (t, a, b) => 3*(1-t)*(1-t)*t*a + 3*(1-t)*t*t*b + t*t*t;
  let low=0, high=1;
  for (let i=0;i<14;i++) { const middle=(low+high)/2; if(cubic(middle,.22,.23)<progress) low=middle; else high=middle; }
  return cubic((low+high)/2,.7,1);
};

function canPaint(element) {
  if (element.closest('[hidden], [inert], .composition-hidden, .auth-arrival')) return false;
  const modal = document.querySelector('dialog[open]');
  if (modal && !modal.contains(element)) return false;
  return element.checkVisibility ? element.checkVisibility({ visibilityProperty: true }) : getComputedStyle(element).visibility !== 'hidden';
}

// The original native texture is warped gently along its radial coordinates.
// One loop owns palette, placement and radiation; no React updates per frame.
export function ContourFieldAnimated({ value, tracking = false, placement, viewport, onReady, animatePlacement = false }) {
  const [compatibility, setCompatibility] = useState(false);
  const canvas = useRef(null), engine = useRef(null), frame = useRef(0);
  const coordinate = useRef(value), target = useRef(value), direct = useRef(tracking);
  const geometry = useRef({ placement, viewport }), placementTarget = useRef(placement), travel = useRef(null);
  const kick = useRef(null), refresh = useRef(null), wave = useRef({ elapsed: 0 });

  useLayoutEffect(() => {
    geometry.current.viewport = viewport;
    const previous = placementTarget.current;
    if (placement && (!previous || ['left','top','width','height'].some(key => Math.abs(placement[key]-previous[key])>.01))) {
      placementTarget.current = placement;
      if (!geometry.current.placement || !animatePlacement || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        geometry.current.placement = placement; travel.current = null;
      } else travel.current = { from: { ...geometry.current.placement }, to: placement, began: performance.now() };
    }
    refresh.current?.(true);
  }, [placement, viewport, animatePlacement]);

  useEffect(() => {
    const element = canvas.current;
    let active = true, intersecting = true, textureReady = false, radiates = false, lastPaint = 0, wasVisible = false;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const gl = compatibility ? null : element.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
    let draw, dispose = () => {};
    if (gl) {
      const resources=[];
      const own=(resource,release)=>{resources.push(()=>release.call(gl,resource));return resource;};
      dispose=()=>{resources.reverse().forEach(release=>release());resources.length=0;};
      try {
      const compile = (kind, source) => { const shader=own(gl.createShader(kind),gl.deleteShader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Contour shader unavailable');return shader; };
      const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),program=own(gl.createProgram(),gl.deleteProgram);
      gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Contour program could not link');
      const buffer=own(gl.createBuffer(),gl.deleteBuffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      gl.useProgram(program);const point=gl.getAttribLocation(program,'point');gl.enableVertexAttribArray(point);gl.vertexAttribPointer(point,2,gl.FLOAT,false,0,0);
      const texture=own(gl.createTexture(),gl.deleteTexture);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      const locations=Object.fromEntries(['viewport','bounds','innerColor','outerColor','wavePhase','waveStrength'].map(name=>[name,gl.getUniformLocation(program,name)]));
      radiates=true;
      draw=position=>{
        const {placement:p,viewport:v}=geometry.current;if(!active||!textureReady||!p||!v?.width)return;
        const density=Math.min(2,window.devicePixelRatio||1,Math.sqrt(3000000/(v.width*v.height))),width=Math.max(1,Math.round(v.width*density)),height=Math.max(1,Math.round(v.height*density));
        if(element.width!==width||element.height!==height){element.width=width;element.height=height;}
        gl.viewport(0,0,width,height);gl.useProgram(program);gl.uniform2f(locations.viewport,v.width,v.height);gl.uniform4f(locations.bounds,p.left-v.left,p.top-v.top,p.width,p.height);
        const colors=contourPalette(position);gl.uniform3fv(locations.innerColor,colors.inner.map(c=>c/255));gl.uniform3fv(locations.outerColor,colors.outer.map(c=>c/255));
        gl.uniform1f(locations.wavePhase,(wave.current.elapsed/RADIATION.period%20)*Math.PI*2);
        gl.uniform1f(locations.waveStrength,motion.matches?0:Math.min(1,wave.current.elapsed/RADIATION.fadeIn));gl.drawArrays(gl.TRIANGLES,0,6);
      };
      engine.current={draw,load:image=>{gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);}};
      } catch {
        dispose(); engine.current=null; setCompatibility(true);
        return () => { active=false; };
      }
    } else {
      // Without a GPU, retain the crisp static design. Do not introduce a
      // CPU-heavy per-pixel animation just to imitate the shader.
      const context=element.getContext('2d'),source=document.createElement('canvas'),paint=source.getContext('2d');let pixels,shades,lastValue;
      draw=position=>{
        const {placement:p,viewport:v}=geometry.current;if(!active||!textureReady||!p||!v?.width)return;
        if(lastValue!==position){const {inner,outer}=contourPalette(position),data=pixels.data;for(let i=0,j=0;i<data.length;i+=4,j++){const blend=shades[j]/255;for(let c=0;c<3;c++)data[i+c]=inner[c]+(outer[c]-inner[c])*blend;data[i+3]=255;}paint.putImageData(pixels,0,0);lastValue=position;}
        const density=Math.min(2,window.devicePixelRatio||1),width=Math.round(v.width*density),height=Math.round(v.height*density);
        if(element.width!==width||element.height!==height){element.width=width;element.height=height;}
        context.setTransform(density,0,0,density,0,0);context.clearRect(0,0,v.width,v.height);
        const x=p.left-v.left,y=p.top-v.top,w=p.width,h=p.height;
        const xs=[[0,1,0,Math.max(0,x)],[0,source.width,x,w],[source.width-1,1,x+w,Math.max(0,v.width-x-w)]];
        const ys=[[0,1,0,Math.max(0,y)],[0,source.height,y,h],[source.height-1,1,y+h,Math.max(0,v.height-y-h)]];
        for(const [sx,sw,dx,dw] of xs)for(const [sy,sh,dy,dh] of ys)if(dw>0&&dh>0)context.drawImage(source,sx,sy,sw,sh,dx,dy,dw,dh);
      };
      engine.current={draw,load:image=>{source.width=image.naturalWidth;source.height=image.naturalHeight;paint.drawImage(image,0,0);pixels=paint.getImageData(0,0,source.width,source.height);shades=new Uint8Array(source.width*source.height);for(let i=0,j=0;i<pixels.data.length;i+=4,j++)shades[j]=Math.max(0,Math.min(255,((pixels.data[i]*.2126+pixels.data[i+1]*.7152+pixels.data[i+2]*.0722)-91)/142*255));}};
    }
    const runnable=()=>active&&textureReady&&intersecting&&!document.hidden&&canPaint(element);
    const stop=()=>{cancelAnimationFrame(frame.current);frame.current=0;lastPaint=0;};
    const updatePosition=now=>{
      if(!travel.current)return false;
      const trip=travel.current,progress=motion.matches?1:Math.min(1,(now-trip.began)/520),blend=ease(progress);
      geometry.current.placement=Object.fromEntries(['left','top','width','height'].map(key=>[key,trip.from[key]+(trip.to[key]-trip.from[key])*blend]));
      if(progress===1)travel.current=null;return true;
    };
    const tick=now=>{
      frame.current=0;if(!runnable())return;
      const changing=coordinate.current!==target.current||Boolean(travel.current);
      if(now-lastPaint<(changing?1000/60:1000/RADIATION.framesPerSecond)-1){frame.current=requestAnimationFrame(tick);return;}
      const paletteElapsed=lastPaint?Math.min(80,now-lastPaint):16;lastPaint=now;
      if(!motion.matches)wave.current.elapsed+=paletteElapsed/1000;
      coordinate.current=direct.current||motion.matches?target.current:coordinate.current+(target.current-coordinate.current)*(1-Math.exp(-paletteElapsed/70));
      if(Math.abs(target.current-coordinate.current)<.001)coordinate.current=target.current;
      updatePosition(now);draw(coordinate.current);
      if(!motion.matches&&(radiates||coordinate.current!==target.current||travel.current))frame.current=requestAnimationFrame(tick);
    };
    kick.current=()=>{if(!motion.matches&&!frame.current&&runnable())frame.current=requestAnimationFrame(tick);};
    refresh.current=force=>{
      if(!active||!textureReady)return;
      if(!runnable()){stop();wasVisible=false;return;}
      if(motion.matches){stop();coordinate.current=target.current;if(travel.current){geometry.current.placement=travel.current.to;travel.current=null;}}
      if(force||!wasVisible||motion.matches){updatePosition(performance.now());draw(coordinate.current);}
      wasVisible=true;kick.current?.();
    };
    const refreshVisible=()=>refresh.current?.(false), refreshMotion=()=>refresh.current?.(true);
    const observer=new IntersectionObserver(([entry])=>{intersecting=entry.isIntersecting;refreshVisible();});observer.observe(element);
    const states=new MutationObserver(refreshVisible);states.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open','hidden','inert','class']});
    document.addEventListener('visibilitychange',refreshVisible);motion.addEventListener('change',refreshMotion);
    const image=new Image();image.onload=()=>{if(!active)return;engine.current.load(image);textureReady=true;coordinate.current=target.current;draw(coordinate.current);onReady?.(true);kick.current?.();};image.src='/art/mood-environment-v4-hq.webp';
    return()=>{active=false;image.onload=null;observer.disconnect();states.disconnect();document.removeEventListener('visibilitychange',refreshVisible);motion.removeEventListener('change',refreshMotion);stop();refresh.current=null;kick.current=null;dispose();engine.current=null;};
  }, [onReady,compatibility]);
  useEffect(()=>{target.current=value;direct.current=tracking;if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)refresh.current?.(true);else kick.current?.();},[value,tracking]);
  return <canvas key={compatibility?'static':'radiating'} ref={canvas} className="contour-field" aria-hidden="true" data-contour-motion={compatibility?'static':'radiating'} style={viewport?{position:'absolute',left:viewport.left,top:viewport.top,width:viewport.width,height:viewport.height}:undefined}/>;
}
