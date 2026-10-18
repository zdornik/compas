import {dayKey} from './domain.js';
import {stageForDay,doseLabel} from './medications.js';

export function currentMedicationRows(entries=[],profile=entries.find(row=>row.type==='medical-profile'),day=dayKey()) {
 const plans=entries.filter(row=>row.type==='medication-plan'&&!row.archived&&(!row.endDate||row.endDate>=day)&&(row.startDate>day||stageForDay(row,day)));
 const rows=plans.map(plan=>{const stage=stageForDay(plan,day);return {id:'plan-'+plan.id,planId:plan.id,name:plan.name,productId:plan.productId||null,details:stage?doseLabel({...plan,...stage})+' · '+plan.times.join(' · '):'Начало '+plan.startDate,source:{type:plan.origin==='doctor'?'doctor':'patient',name:plan.prescriberName},fromTherapy:true,plan};});
 for(const row of profile?.medications||[])rows.push({...row,fromTherapy:false});
 return rows.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
