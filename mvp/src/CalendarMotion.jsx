import { useLayoutEffect, useRef, useState } from 'react';

// One measured viewport expands with its content; the outgoing grid remains
// visible while the next grid slides in. Its controls are inert immediately.
export function CalendarMotion({ pageKey, direction = 0, children }) {
  const panel = useRef(null), previous = useRef(null);
  const [outgoing, setOutgoing] = useState(null);
  const [height, setHeight] = useState(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (previous.current && previous.current.key !== pageKey && !reduced) setOutgoing(previous.current);
    else if (reduced) setOutgoing(null);
    const timer = setTimeout(() => setOutgoing(null), 460);
    return () => clearTimeout(timer);
  }, [pageKey]);
  useLayoutEffect(() => { previous.current = { key: pageKey, children }; });
  useLayoutEffect(() => {
    const measure = () => {
      if (panel.current?.offsetHeight) setHeight(panel.current.offsetHeight);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel.current); measure();
    const frame = requestAnimationFrame(() => setReady(true));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pageKey]);
  return <div className={`calendar-motion ${ready ? 'motion-ready' : ''} ${outgoing ? 'is-changing' : ''}`} style={{ height: height ?? undefined, '--calendar-direction': direction, '--calendar-enter-y': direction === 0 ? '7px' : '0px' }}>
    {outgoing && <div key={`out:${outgoing.key}`} className="calendar-motion-panel calendar-motion-out" aria-hidden="true" inert>{outgoing.children}</div>}
    <div key={pageKey} ref={panel} className="calendar-motion-panel calendar-motion-current">{children}</div>
  </div>;
}
