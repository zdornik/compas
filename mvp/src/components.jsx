import { useLayoutEffect, useRef } from 'react';
import { X, CaretRight } from '@phosphor-icons/react';

export function Modal({ title, children, onClose, className = '', style, headerLead }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} style={style} className={`modal ${className}`} aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    {headerLead}
    <div className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={22}/></button></div>
    {children}
  </dialog>;
}
export function Row({ icon: Icon, title, subtitle, end, onClick, className = '' }) {
  return <button className={`list-row ${className}`} onClick={onClick}>
    <span className="row-icon"><Icon size={25} weight="regular"/></span>
    <span className="row-copy"><strong>{title}</strong><small>{subtitle}</small></span>
    <span className="row-end">{end}</span><CaretRight size={19} className="chevron"/>
  </button>;
}
export function Chips({ items, selected, onChange }) {
  return <div className="chips">{items.map(item => <button key={item} className={`chip ${selected.includes(item) ? 'selected' : ''}`} aria-pressed={selected.includes(item)} onClick={() => onChange(selected.includes(item) ? selected.filter(x => x !== item) : [...selected, item])}>{item}</button>)}</div>;
}
export function Art({ tone = 'sage', className = '', label }) {
  return <div className={`art ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {['sage', 'blue', 'yellow'].map(t => <img key={t} src={`/art/mood-${t}.webp`} alt="" draggable="false" className={`art-layer ${tone === t ? 'visible' : ''}`}/>)}
  </div>;
}
