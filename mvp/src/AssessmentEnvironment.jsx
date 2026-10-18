import { MascotFace } from './MascotFace.jsx';
import { useEffect, useLayoutEffect, useState } from 'react';
import { ContourField } from './ContourField.jsx';
import { contourPlacement } from './contour-placement.js';
import { moodVisualAt } from './mood-motion.js';

// One environment survives the whole screening flow. Its canvas has stable
// geometry while the clipping layer follows the animated window's height.
export function AssessmentEnvironment({ value, stage, slot, maxHeight, scrollSource, environmentRef }) {
  const root = environmentRef;
  const [layout, setLayout] = useState(null);
  const [painted, setPainted] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const hasLayout = Boolean(layout);
  useEffect(() => {
    if (!hasLayout || !painted) return;
    let second;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setMotionReady(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [hasLayout, painted]);
  useLayoutEffect(() => {
    const element = root.current;
    const measure = () => {
      const target = slot.current;
      if (!target || !element.clientWidth) return;
      const area = element.getBoundingClientRect(), anchor = target.getBoundingClientRect();
      const width = element.clientWidth, height = element.clientHeight;
      const x = (anchor.left + anchor.width * .82 - area.left) * width / area.width;
      const y = (anchor.top + anchor.height * .52 - area.top) * height / area.height + (scrollSource.current?.scrollTop || 0);
      const baseFigureWidth = width < 360 ? 88 : 100;
      const figureWidth = stage === 'questions' ? baseFigureWidth * .86 : baseFigureWidth;
      // Exactly the mood editor's figure/pocket ratio, independent of the
      // window's dimensions. Outer colour fills space beyond the native art.
      setLayout({ figure: { left: x, top: y, width: figureWidth }, viewport: { left:0, top:-maxHeight, width, height:maxHeight*3 }, image: contourPlacement({ width, height, centerX: x, centerY: y, figureWidth, figureHeight: figureWidth * 1408 / 1126, cover: false }) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (slot.current) observer.observe(slot.current);
    return () => observer.disconnect();
  }, [stage, slot, maxHeight, scrollSource, root]);
  const visual = moodVisualAt(value);
  return <div ref={root} aria-hidden="true" className={`assessment-environment ${painted && layout ? 'ready' : ''} ${motionReady ? 'motion-ready' : ''} ${stage === 'questions' ? 'question-mode' : ''}`} style={{ '--mouth-y': visual.mouth, '--eye-y': visual.eyes, '--brow-y': `${visual.browY}px`, '--brow-left': `${visual.browAngle}deg`, '--brow-right': `${-visual.browAngle}deg`, '--brow-opacity': visual.browOpacity, '--head-tilt': `${visual.tilt}deg` }}><div className="assessment-environment-plane">
    <ContourField value={value} placement={layout?.image} viewport={layout?.viewport} onReady={setPainted} animatePlacement={motionReady}/>
    <div className="mascot-figure" style={layout?.figure}><div className="mascot-breath"><img className="mascot-body" src="/art/mascot-rig-v2.webp" alt="" draggable="false"/><MascotFace value={value}/></div></div>
  </div></div>;
}
