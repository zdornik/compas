import { useLayoutEffect, useRef, useState } from 'react';
import { ContourCanvas } from './ContourCanvas.jsx';
import { contourPlacement } from './contour-placement.js';
import { moodVisualAt } from './mood-motion.js';

export function MoodScene({ value = 3, label }) {
  const scene = useRef(null);
  const [layout, setLayout] = useState(null);
  useLayoutEffect(() => {
    const element = scene.current;
    const measure = () => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      const mobile = window.matchMedia('(max-width: 760px)').matches;
      const figureWidth = mobile ? 174 : 245;
      const x = width * (mobile ? .73 : .81), y = height * (mobile ? .55 : .52);
      setLayout({
        width, height, x, y,
        figure: { left: x, top: y, width: figureWidth },
        image: contourPlacement({ width, height, centerX: x, centerY: y, figureWidth, figureHeight: figureWidth * 1408 / 1126 }),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const visual = moodVisualAt(value);
  const style = {
    '--scene-bg': visual.background,
    '--mouth-y': visual.mouth, '--eye-y': visual.eyes,
    '--brow-y': `${visual.browY}px`, '--brow-left': `${visual.browAngle}deg`, '--brow-right': `${-visual.browAngle}deg`,
    '--brow-opacity': visual.browOpacity, '--head-tilt': `${visual.tilt}deg`,
  };
  return <div ref={scene} className="mood-scene scene-hero" style={style} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <ContourCanvas value={value} style={layout?.image} src="/art/mood-environment-v4-hq.webp"/>
    <div className="mascot-figure" style={layout?.figure}><div className="mascot-breath">
      <img className="mascot-body" src="/art/mascot-rig-v2.webp" alt="" draggable="false"/>
      <div className="mascot-face">{['brow-left','brow-right','eye-left','eye-right','mouth'].map(part => <img key={part} className={`face-feature ${part}`} src="/art/face-rig-v2.webp" alt="" draggable="false"/>)}</div>
    </div></div>
  </div>;
}
