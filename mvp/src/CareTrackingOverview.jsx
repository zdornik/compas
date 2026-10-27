import {useEntryHistory,HistoryStatus} from './useEntryHistory.jsx';
import {mergeEntries} from './history-data.js';
import {dayKey} from './domain.js';
import {addDays} from './medications.js';
import {TrackingCards} from './TrackingCards.jsx';
import {MoodTrend} from './MoodTrend.jsx';
import {MedicationTracking} from './MedicationTracking.jsx';
export function CareTrackingOverview({entries,tracking,doctorId,linkId,owner,active,enabled,selected,onSelect}){
 const today=dayKey(),from=addDays(today,-13),history=useEntryHistory({kind:'observations',from,to:today,linkId,owner,active,enabled});
 const all=mergeEntries(history.entries,entries);
 return <><TrackingCards tracking={tracking}/><HistoryStatus resource={history}/>{!history.loading&&!history.error&&<MoodTrend entries={all} from={from} to={today} selected={selected} onSelect={onSelect}/>}<MedicationTracking entries={entries} linkId={linkId} owner={owner} active={active} enabled={enabled} doctorId={doctorId} doctorOnly onSelect={onSelect}/></>;
}
