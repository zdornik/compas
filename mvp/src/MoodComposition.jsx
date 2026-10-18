import { MascotFace } from './MascotFace.jsx';
import { useLayoutEffect, useRef, useState } from 'react';
import { ContourField } from './ContourField.jsx';
import { contourPlacement } from './contour-placement.js';
import { moodVisualAt } from './mood-motion.js';

// A single persistent visual group. Both its raster background and character
// share one transform, so moving between steps cannot resize them separately.
export function MoodComposition({ position, tracking, step, label }) {
  const layer = useRef(null);
  const expanded = useRef(null);
  const [layout, setLayout] = useState(null);
  const [painted, setPainted] = useState(false);
  useLayoutEffect(() => {
    const element = layer.current;
    const dialog = element.closest('dialog');
    const slot = dialog.querySelector('.scene-slot');
    if (!slot) return;
    const measure = () => {
      const area = element.getBoundingClientRect();
      const target = slot.getBoundingClientRect();
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height || !target.width) return;
      // Layout coordinates stay stable while the dialog itself is animating.
      const x = (target.x + target.width / 2 - area.x) * width / area.width;
      const y = (target.y + target.height * .47 - area.y) * height / area.height;
      const figureWidth = window.innerHeight <= 720 ? 147 : window.innerWidth <= 760 ? 180 : 196;
      let base = expanded.current;
      if (!base || step === 0) {
        base = { x, y, figureWidth, width, height };
        base.image = contourPlacement({ width, height, centerX: x, centerY: y, figureWidth, figureHeight: figureWidth * 1408 / 1126 });
        expanded.current = base;
      }
      const scale = step === 1 ? 130 / base.figureWidth : 1;
      setLayout({ ...base, transform: `translate(${x - base.x}px,${y - base.y}px) scale(${scale})` });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(slot);
    // Opening changes layout once. Animation completion must not re-place art.
    return () => observer.disconnect();
  }, [step]);
  const visual = moodVisualAt(position);
  const style = {
    backgroundColor: visual.background,
    '--mouth-y': visual.mouth, '--eye-y': visual.eyes,
    '--brow-y': `${visual.browY}px`, '--brow-left': `${visual.browAngle}deg`, '--brow-right': `${-visual.browAngle}deg`,
    '--brow-opacity': visual.browOpacity, '--head-tilt': `${visual.tilt}deg`,
  };
  return <div ref={layer} className={`mood-composition ${layout && painted ? 'ready' : ''} ${step > 1 ? 'composition-hidden' : ''}`} style={style} role="img" aria-label={label} aria-hidden={step > 1}>
    <div className="composition-moving" style={layout ? { width: layout.width, height: layout.height, transformOrigin: `${layout.x}px ${layout.y}px`, transform: layout.transform } : undefined}>
      <ContourField value={position} tracking={tracking} onReady={setPainted} placement={layout?.image} viewport={layout ? { left:-layout.width*.4, top:-layout.height*.4, width:layout.width*1.8, height:layout.height*2 } : undefined}/>
      <div className="mascot-figure" style={layout ? { left: layout.x, top: layout.y, width: layout.figureWidth } : undefined}><div className="mascot-breath">
        <img className="mascot-body" src="/art/mascot-rig-v2.webp" alt="" draggable="false"/>
        <MascotFace value={position} tracking={tracking}/>
      </div></div>
    </div>
  </div>;
}
