import { useEffect, useLayoutEffect, useRef } from 'react';
import { contourPalette } from './mood-motion.js';

const vertex = `attribute vec2 point;varying vec2 uv;void main(){uv=(point+1.0)*.5;gl_Position=vec4(point,0.,1.);}`;
const fragment = `precision highp float;varying vec2 uv;uniform sampler2D art;uniform vec2 viewport;uniform vec4 bounds;uniform vec3 innerColor;uniform vec3 outerColor;
void main(){vec2 p=vec2(uv.x,1.-uv.y)*viewport;vec2 source=(p-bounds.xy)/bounds.zw;vec3 original=texture2D(art,clamp(source,0.,1.)).rgb;float shade=floor(clamp((dot(original,vec3(.2126,.7152,.0722))*255.-91.)/142.,0.,1.)*255.)/255.;vec2 outside=max(max(-source,source-1.),0.);shade=mix(shade,1.,smoothstep(0.,.32,length(outside)));gl_FragColor=vec4(mix(innerColor,outerColor,shade),1.);}`;
const ease = progress => {
  const cubic = (t, a, b) => 3*(1-t)*(1-t)*t*a + 3*(1-t)*t*t*b + t*t*t;
  let low=0, high=1;
  for (let i=0;i<14;i++) { const middle=(low+high)/2; if(cubic(middle,.22,.23)<progress) low=middle; else high=middle; }
  return cubic((low+high)/2,.7,1);
};

// Sample the same native texture at the mood editor's scale. Outside the image
// its edge colours continue into the outer palette, so no rectangle is visible.
// Recolouring is a GPU shader; neither pixel loops nor a render loop run at rest.
export function ContourField({ value, tracking = false, placement, viewport, onReady, animatePlacement = false }) {
  const canvas = useRef(null), engine = useRef(null), frame = useRef(0);
  const coordinate = useRef(value), target = useRef(value), direct = useRef(tracking);
  const geometry = useRef({ placement, viewport });
  const positionFrame = useRef(0), placementTarget = useRef(placement);
  const kick = useRef(null);
  useLayoutEffect(() => {
    geometry.current.viewport=viewport;
    const previousTarget=placementTarget.current;
    if (placement && (!previousTarget || ['left','top','width','height'].some(key=>Math.abs(placement[key]-previousTarget[key])>.01))) {
      cancelAnimationFrame(positionFrame.current); placementTarget.current=placement;
      if (!geometry.current.placement || !animatePlacement || window.matchMedia('(prefers-reduced-motion: reduce)').matches) geometry.current.placement=placement;
      else {
        const start={...geometry.current.placement}, began=performance.now();
        const tick=now=>{
          const progress=Math.min(1,(now-began)/520), blend=ease(progress);
          geometry.current.placement=Object.fromEntries(['left','top','width','height'].map(key=>[key,start[key]+(placement[key]-start[key])*blend]));
          engine.current?.draw(coordinate.current);
          if(progress<1) positionFrame.current=requestAnimationFrame(tick);
        }; positionFrame.current=requestAnimationFrame(tick);
      }
    }
    engine.current?.draw(coordinate.current);
  }, [placement, viewport, animatePlacement]);
  useEffect(() => {
    const element = canvas.current;
    let active = true, visible = true, textureReady = false;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const gl = element.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    let draw, dispose = () => {};
    if (gl) {
      const compile = (kind, source) => { const shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Contour shader compilation failed'); return shader; };
      const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
      const program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      gl.useProgram(program); const point = gl.getAttribLocation(program, 'point'); gl.enableVertexAttribArray(point); gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const locations = Object.fromEntries(['viewport','bounds','innerColor','outerColor'].map(name => [name, gl.getUniformLocation(program, name)]));
      draw = value => {
        const { placement: p, viewport: v } = geometry.current;
        if (!active || !textureReady || !p || !v?.width) return;
        const density = Math.min(2, window.devicePixelRatio || 1), width = Math.round(v.width * density), height = Math.round(v.height * density);
        if (element.width !== width || element.height !== height) { element.width = width; element.height = height; }
        gl.viewport(0, 0, width, height); gl.useProgram(program);
        gl.uniform2f(locations.viewport, v.width, v.height); gl.uniform4f(locations.bounds, p.left - v.left, p.top - v.top, p.width, p.height);
        const colors = contourPalette(value); gl.uniform3fv(locations.innerColor, colors.inner.map(c => c / 255)); gl.uniform3fv(locations.outerColor, colors.outer.map(c => c / 255)); gl.drawArrays(gl.TRIANGLES, 0, 6);
      };
      engine.current = { draw, load: image => { gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image); } };
      dispose = () => { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); };
    } else {
      // Canvas2D fallback for devices with WebGL disabled. Only palette changes
      // recolour native pixels; drawing beyond the texture clamps edge strips.
      const context = element.getContext('2d'), source = document.createElement('canvas'), paint = source.getContext('2d');
      let pixels, shades, lastValue;
      draw = value => {
        const { placement: p, viewport: v } = geometry.current;
        if (!active || !textureReady || !p || !v?.width) return;
        if (lastValue !== value) {
          const { inner, outer } = contourPalette(value), data = pixels.data;
          for (let i = 0, j = 0; i < data.length; i += 4, j++) { const mix = shades[j] / 255; for (let c = 0; c < 3; c++) data[i+c] = inner[c] + (outer[c] - inner[c]) * mix; data[i+3] = 255; }
          paint.putImageData(pixels, 0, 0); lastValue = value;
        }
        const density = Math.min(2, window.devicePixelRatio || 1); element.width = Math.round(v.width * density); element.height = Math.round(v.height * density); context.scale(density, density);
        const x = p.left - v.left, y = p.top - v.top, w = p.width, h = p.height;
        const xs = [[0,1,0,Math.max(0,x)],[0,source.width,x,w],[source.width-1,1,x+w,Math.max(0,v.width-x-w)]];
        const ys = [[0,1,0,Math.max(0,y)],[0,source.height,y,h],[source.height-1,1,y+h,Math.max(0,v.height-y-h)]];
        for (const [sx,sw,dx,dw] of xs) for (const [sy,sh,dy,dh] of ys) if (dw>0 && dh>0) context.drawImage(source,sx,sy,sw,sh,dx,dy,dw,dh);
      };
      engine.current = { draw, load: image => { source.width=image.naturalWidth; source.height=image.naturalHeight; paint.drawImage(image,0,0); pixels=paint.getImageData(0,0,source.width,source.height); shades=new Uint8Array(source.width*source.height); for(let i=0,j=0;i<pixels.data.length;i+=4,j++) shades[j]=Math.max(0,Math.min(255,((pixels.data[i]*.2126+pixels.data[i+1]*.7152+pixels.data[i+2]*.0722)-91)/142*255)); } };
    }
    kick.current = () => {
      if (frame.current || !textureReady || !visible || document.hidden) return;
      let previous = performance.now();
      const tick = now => {
        frame.current = 0; if (!active || !visible || document.hidden) return;
        const elapsed = Math.min(50, Math.max(1, now - previous)); previous = now;
        coordinate.current = direct.current || motion.matches ? target.current : coordinate.current + (target.current-coordinate.current)*(1-Math.exp(-elapsed/70));
        if (Math.abs(target.current-coordinate.current)<.001) coordinate.current=target.current;
        draw(coordinate.current); if (coordinate.current!==target.current) frame.current=requestAnimationFrame(tick);
      }; frame.current=requestAnimationFrame(tick);
    };
    const refresh = () => { cancelAnimationFrame(frame.current); frame.current=0; if (visible && !document.hidden) { coordinate.current=target.current; draw(coordinate.current); } };
    const observer = new IntersectionObserver(([entry]) => { visible=entry.isIntersecting; refresh(); }); observer.observe(element);
    document.addEventListener('visibilitychange', refresh);
    const image = new Image(); image.onload = () => { if (!active) return; engine.current.load(image); textureReady=true; coordinate.current=target.current; draw(coordinate.current); onReady?.(true); }; image.src='/art/mood-environment-v4-hq.webp';
    return () => { active=false; image.onload=null; observer.disconnect(); document.removeEventListener('visibilitychange',refresh); cancelAnimationFrame(frame.current); cancelAnimationFrame(positionFrame.current); frame.current=0; dispose(); engine.current=null; };
  }, [onReady]);
  useEffect(() => { target.current=value; direct.current=tracking; kick.current?.(); }, [value, tracking]);
  return <canvas ref={canvas} className="contour-field" aria-hidden="true" style={viewport ? { position:'absolute', left:viewport.left, top:viewport.top, width:viewport.width, height:viewport.height } : undefined}/>;
}
