import { MascotFace } from './MascotFace.jsx';
import { useLayoutEffect, useRef, useState } from 'react';
import { ContourField } from './ContourField.jsx';
import { contourPlacement } from './contour-placement.js';
import { moodVisualAt } from './mood-motion.js';

export function MoodScene({ value = 3, label, variant = 'hero', onActivate }) {
  const scene = useRef(null);
  const [layout, setLayout] = useState(null);
  const [painted,setPainted]=useState(false);
  useLayoutEffect(() => {
    const element = scene.current;
    const measure = () => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      const mobile = window.matchMedia('(max-width: 760px)').matches;
      const compact = variant.startsWith('assessment');
      const entry = variant === 'entry';
      const figureWidth = entry ? (mobile ? (width < 330 ? 115 : 135) : 180) : compact ? (variant === 'assessment-small' ? 60 : 100) : window.innerHeight <= 720 ? 147 : mobile ? 180 : 196;
      const x = width * (entry ? (mobile ? .77 : .56) : compact ? (variant === 'assessment-small' ? .5 : .81) : mobile ? .73 : .81), y = height * (entry ? .47 : compact ? .52 : mobile ? .55 : .52);
      setLayout({
        width, height, x, y,
        figure: { left: x, top: y, width: figureWidth },
        image: contourPlacement({ width, height, centerX: x, centerY: y, figureWidth, figureHeight: figureWidth * 1408 / 1126, cover: false }),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [variant]);
  const visual = moodVisualAt(value);
  const style = {
    '--scene-bg': visual.background,
    '--mouth-y': visual.mouth, '--eye-y': visual.eyes,
    '--brow-y': `${visual.browY}px`, '--brow-left': `${visual.browAngle}deg`, '--brow-right': `${-visual.browAngle}deg`,
    '--brow-opacity': visual.browOpacity, '--head-tilt': `${visual.tilt}deg`,
  };
  return <div data-scene-ready={painted} ref={scene} className={`mood-scene scene-hero ${variant.startsWith('assessment') ? 'scene-assessment' : ''}`} style={style} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : onActivate ? undefined : true}>
    <ContourField onReady={setPainted} value={value} placement={layout?.image} viewport={layout ? { left:0, top:0, width:layout.width, height:layout.height } : undefined}/>
    {onActivate && layout && <div className="mascot-hit-area" style={layout.figure}>
      <button className="mascot-hit-button" type="button" aria-label="Оценить настроение, нажав на маскота" onClick={onActivate}/>
    </div>}
    <div className="mascot-figure" style={layout?.figure}><div className="mascot-breath">
      <img className="mascot-body" src="/art/mascot-rig-v2.webp" alt="" draggable="false"/>
      <MascotFace value={value}/>
    </div></div>
  </div>;
}
