// Newly generated synthetic accounts only. Never exports an existing database or session.
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dayKey,MOODS} from '../src/domain.js';
import {addDays,medicationDraft,medicationDoseId} from '../src/medications.js';
import {appointmentStart} from '../src/appointments.js';
import {JOURNAL_POLICY} from '../server/journal-policy.mjs';

export async function bundleAccountPassword(path){
 const value=JSON.parse(await readFile(path,'utf8'));
 if(value.version!==1||value.syntheticOnly!==true||value.purpose!=='compass-macos-demo'||typeof value.demoPassword!=='string'||value.demoPassword.length<12||value.demoPassword.length>128)throw Error('Invalid synthetic demo bundle manifest');
 return value.demoPassword;
}
export async function seedPresentationFixture(store,{password=randomBytes(18).toString('base64url'),extended=false}={}){
 const credentials={syntheticOnly:true,password,patient:'patient@compass.example.invalid',doctor:'doctor@compass.example.invalid',otherPatient:'other@compass.example.invalid'},sessions={};
 for(const [name,role] of [['patient','patient'],['doctor','doctor'],['otherPatient','patient']]){
  const value=await store.auth.register({role,email:credentials[name],password,profile:{name:'Тестовый',surname:name==='doctor'?'Врач':name==='patient'?'Пациент':'Другой пациент',...(role==='patient'?{age:30}:{})},consents:{healthData:true}});
  sessions[name]=await store.session(value.token);
 }
 const patient=sessions.patient,doctor=sessions.doctor,care=await store.care.links(patient),link=await store.care.claim(doctor,care.profile.code),today=dayKey();
 await store.care.consent(patient,link.id,'active');
 await store.auth.consents(patient,{healthData:true,journalProcessing:true,journalSharing:true,journalAiProcessing:true,providerPolicyVersion:JOURNAL_POLICY});
 for(let i=13;i>=0;i--){
  const day=addDays(today,-i),value=2+i%3;
  for(const entry of [{id:randomUUID(),type:'mood',value,words:extended?[MOODS[value].words[0]]:[],factors:extended?[i%2?'Отдых':'Работа']:[],note:'',kind:'day',day},{id:randomUUID(),type:'sleep',hours:7,minutes:i%2?30:0,quality:'Хорошо',day}])await store.saveEntry(patient.patient_id,entry.id,entry);
 }
 for(const [title,body] of [['Вымышленный день','Это синтетическая запись для демонстрации сохранения и тестового саммари.'],['Тестовое уведомление','[TEST:elevated] Вымышленная запись для проверки маршрута уведомления.']]){
  const entry={id:randomUUID(),type:'journal',title,body,day:today,expectedRevision:0,mutationId:randomUUID()};await store.saveEntry(patient.patient_id,entry.id,entry);
 }
 if(extended){
  await store.saveEntry(patient.patient_id,'medical-profile',{id:'medical-profile',type:'medical-profile',expectedRevision:0,medications:[],conditions:[{id:randomUUID(),name:'Демонстрационное состояние (вымышленное)',details:'Учебная запись; не является диагнозом.'}]});
  const plans=[];
  for(const [index,origin] of ['patient','doctor'].entries()){
   const draft={...medicationDraft(),name:`Демо-препарат ${index?'Б':'А'} (вымышленный)`,strength:1,quantity:1,startDate:addDays(today,-13),times:[index?'18:00':'09:00'],instructions:'Учебная схема с вымышленным препаратом. Не медицинская рекомендация.'};
   if(origin==='doctor'){
    const report=await store.care.check(doctor,link.id,{plan:draft,planId:draft.id,productId:null,documentId:null});
    plans.push(await store.care.prescribe(doctor,link.id,{plan:draft,productId:null,documentId:null,reviewedFingerprint:report.fingerprint,acknowledged:true}));
   }else plans.push(await store.saveEntry(patient.patient_id,draft.id,{...draft,type:'medication-plan'}));
  }
  for(let i=13;i>=1;i--)for(const plan of plans){
   const day=addDays(today,-i),time=plan.times[0],id=medicationDoseId(plan.id,day,time);
   await store.saveEntry(patient.patient_id,id,{id,type:'medication-dose',planId:plan.id,day,time,status:i>3&&i%5===0?'skipped':'taken',expectedRevision:0});
  }
  for(const [scaleId,answers] of [['phq9',[0,1,1,0,0,0,0,0,0]],['gad7',[1,0,1,0,0,0,0]]]){const id=randomUUID();await store.saveEntry(patient.patient_id,id,{id,type:'assessment',scaleId,answers,impact:0});}
  await store.care.saveClinicalNote(doctor,link.id,{id:randomUUID(),expectedRevision:0,kind:'psychotherapy',method:'cbt',title:'Демонстрационный комментарий',body:'Пример заметки о ходе встречи. Наблюдения и участники вымышлены; методика терапии здесь не реализована.',day:today});
  await store.appointments.create(doctor,{id:randomUUID(),linkId:link.id,startsAt:appointmentStart(addDays(today,1),'10:00'),durationMinutes:30,format:'online',note:'Вымышленный приём для показа календаря'});
  await store.appointments.create(patient,{id:randomUUID(),linkId:link.id,startsAt:appointmentStart(addDays(today,2),'11:00'),durationMinutes:30,format:'online',note:'Вымышленный запрос пациента'});
 }
 credentials.linkId=link.id;return credentials;
}
