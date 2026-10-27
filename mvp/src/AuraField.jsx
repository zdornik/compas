import { useLayoutEffect } from 'react';
import { contourPalette } from './mood-motion.js';
import './aura-field.css';

// Use the existing mood palette and the mascot's own anchor in every scene.
export function AuraField({ value, figure, viewport, onReady, animatePlacement = false }) {
  const ready = Boolean(figure && viewport);
  useLayoutEffect(() => { if (ready) onReady?.(true); }, [ready, onReady]);
  if (!ready) return null;
  const { inner, outer } = contourPalette(value);
  return <div className={`aura-field${animatePlacement ? ' aura-reposition' : ''}`} aria-hidden="true"
    style={{ left: viewport.left, top: viewport.top, width: viewport.width, height: viewport.height,
      '--aura-inner': `rgb(${inner.join(',')})`, '--aura-outer': `rgb(${outer.join(',')})` }}>
    <div className="aura-anchor" style={{ left: figure.left - viewport.left, top: figure.top - viewport.top,
      width: figure.width * 1.95, height: figure.width * 1.95 }}><div className="aura-disc"/></div>
  </div>;
}
