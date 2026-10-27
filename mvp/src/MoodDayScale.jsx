import { contourPalette } from './mood-motion.js';
import { MOODS, timeLabel } from './domain.js';
import './mood-day-scale.css';
export function moodScaleLabel(records){return records.map(record=>`${timeLabel(record.at)} — ${MOODS[record.value].short}`).join('; ');}
export function MoodDayScale({records}){
 const groups=records.reduce((all,record)=>{const last=all.at(-1);if(last?.value===record.value)last.count++;else all.push({id:record.id,value:record.value,count:1});return all;},[]);
 return <span className="mood-day-scale" aria-hidden="true" title={moodScaleLabel(records)}>{groups.map(record=>{const {inner,outer}=contourPalette(record.value);return <span key={record.id} className="mood-day-segment" style={{flex:record.count,'--mood-inner':`rgb(${inner.join(',')})`,'--mood-outer':`rgb(${outer.join(',')})`}}/>;})}</span>;
}
export function MoodAuraMark({value,className=''}){const {inner,outer}=contourPalette(value);return <span className={`mood-aura-mark ${className}`} aria-hidden="true" style={{'--mood-inner':`rgb(${inner.join(',')})`,'--mood-outer':`rgb(${outer.join(',')})`}}/>;}
