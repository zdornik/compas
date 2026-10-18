import { useEffect, useRef } from 'react';
import { moodVisualAt } from './mood-motion.js';

// Curves change shape instead of reflecting/scaling a bitmap stroke. All
// emotions retain the same stroke width and the same eye/mouth endpoints.
export function mascotFaceGeometry(value) {
  const pose = moodVisualAt(value);
  const browY = 35 + pose.browY * .45, slope = Math.tan(pose.browAngle * .6 * Math.PI / 180) * 7.04;
  const eyeControlY = 50.5 - pose.eyes * 1.2;
  return {
    leftBrow: `M25.96 ${browY - slope} Q33 ${browY - 1.8} 40.04 ${browY + slope}`,
    rightBrow: `M59.96 ${browY + slope} Q67 ${browY - 1.8} 74.04 ${browY - slope}`,
    leftEye: `M25.96 53 Q33 ${eyeControlY} 40.04 53`,
    rightEye: `M59.96 53 Q67 ${eyeControlY} 74.04 53`,
    mouth: `M42.96 68 Q50 ${68 + pose.mouth * 6.5} 57.04 68`,
    browOpacity: pose.browOpacity * .8,
  };
}

export function MascotFace({ value, tracking = false }) {
  const svg = useRef(null), paths = useRef({});
  const initial = useRef(mascotFaceGeometry(value));
  const coordinate = useRef(value), target = useRef(value), direct = useRef(tracking), frame = useRef(0), kick = useRef(null);
  useEffect(() => {
    let active = true, visible = true;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const draw = position => {
      const geometry = mascotFaceGeometry(position);
      for (const key of ['leftBrow', 'rightBrow', 'leftEye', 'rightEye', 'mouth']) paths.current[key]?.setAttribute('d', geometry[key]);
      paths.current.leftBrow?.setAttribute('opacity', geometry.browOpacity);
      paths.current.rightBrow?.setAttribute('opacity', geometry.browOpacity);
    };
    const stop = () => { cancelAnimationFrame(frame.current); frame.current = 0; };
    kick.current = () => {
      if (!active || frame.current || !visible || document.hidden) return;
      if (motion.matches) { coordinate.current = target.current; draw(coordinate.current); return; }
      let previous = performance.now();
      const tick = now => {
        frame.current = 0;
        if (!active || !visible || document.hidden) return;
        const elapsed = Math.min(50, Math.max(1, now - previous)); previous = now;
        coordinate.current += (target.current - coordinate.current) * (1 - Math.exp(-elapsed / (direct.current ? 65 : 115)));
        if (Math.abs(coordinate.current - target.current) < .001) coordinate.current = target.current;
        draw(coordinate.current);
        if (coordinate.current !== target.current) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    };
    const refresh = () => { stop(); if (visible && !document.hidden) { coordinate.current = target.current; draw(coordinate.current); } };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); });
    observer.observe(svg.current); document.addEventListener('visibilitychange', refresh); motion.addEventListener('change', refresh);
    draw(coordinate.current);
    return () => { active = false; stop(); kick.current = null; observer.disconnect(); document.removeEventListener('visibilitychange', refresh); motion.removeEventListener('change', refresh); };
  }, []);
  useEffect(() => { target.current = value; direct.current = tracking; kick.current?.(); }, [value, tracking]);
  return <svg className="mascot-face mascot-face-vector" ref={svg} viewBox="0 0 100 100" fill="none" stroke="#474844" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {['leftBrow', 'rightBrow', 'leftEye', 'rightEye', 'mouth'].map(key => <path key={key} ref={node => { paths.current[key] = node; }} data-face-part={key} d={initial.current[key]} opacity={key.includes('Brow') ? initial.current.browOpacity : 1}/>) }
  </svg>;
}
