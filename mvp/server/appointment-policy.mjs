import {createHmac} from 'node:crypto';
import {dayKey} from '../src/domain.js';

const fail=message=>{throw Object.assign(new Error(message),{status:422});};
export const appointmentUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const appointmentHash=(key,value)=>createHmac('sha256',key).update('appointment-v1\0'+JSON.stringify(value)).digest('hex');
export function appointmentInput(input){
 if(!appointmentUuid(input?.id)||!appointmentUuid(input?.linkId))fail('Выберите подключённого врача или пациента');
 const startsAt=input.startsAt;
 if(typeof startsAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(startsAt)||startsAt.startsWith('0000')||!Number.isFinite(Date.parse(startsAt))||new Date(startsAt).toISOString()!==startsAt)fail('Проверьте дату и время приёма');
 const durationMinutes=input.durationMinutes;
 if(!Number.isInteger(durationMinutes)||durationMinutes<15||durationMinutes>180||durationMinutes%5)fail('Длительность приёма: от 15 до 180 минут с шагом 5 минут');
 if(!['in_person','online'].includes(input.format))fail('Выберите формат приёма');
 if(typeof input.note!=='string'||input.note.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.note))fail('Комментарий должен содержать не более 1000 символов');
 return {id:input.id.toLowerCase(),linkId:input.linkId.toLowerCase(),startsAt,durationMinutes,format:input.format,note:input.note.replace(/\r\n?/g,'\n').trim()};
}
export function appointmentFuture(startsAt,now=new Date()){
 const delta=Date.parse(startsAt)-now.getTime();
 if(!Number.isFinite(delta)||delta<=0)fail('Выберите время в будущем');
 if(delta>366*86400000)fail('Запись доступна не более чем на год вперёд');
}
export function appointmentAction(input,action){
 if(!['confirm','decline','cancel'].includes(action))fail('Некорректное действие с приёмом');
 if(!appointmentUuid(input?.mutationId))fail('Передайте идентификатор действия');
 if(!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision<1)fail('Обновите список приёмов');
 return {mutationId:input.mutationId.toLowerCase(),expectedRevision:input.expectedRevision,action};
}
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000')||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Проверьте период календаря');
 return value;
}
export function appointmentPage(params,now=new Date()){
 const from=date(params.get('from')||dayKey(now)),to=date(params.get('to')||new Date(Date.parse(from)+365*86400000).toISOString().slice(0,10));
 if(to<from||Date.parse(to)-Date.parse(from)>366*86400000)fail('Выберите период не более года');
 const status=params.get('status')||null;
 if(status&&!['requested','confirmed','declined','cancelled'].includes(status))fail('Некорректный статус приёма');
 const limit=Number(params.get('limit')||100);
 if(!Number.isInteger(limit)||limit<1||limit>200)fail('Некорректный размер страницы');
 let after=null;
 if(params.has('after')){
  const value=params.get('after');
  if(!value||value.length>300||!/^[A-Za-z0-9_-]+$/.test(value))fail('Некорректная страница приёмов');
  try{after=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{fail('Некорректная страница приёмов');}
  if(!appointmentUuid(after?.id)||typeof after.at!=='string'||!Number.isFinite(Date.parse(after.at))||new Date(after.at).toISOString()!==after.at)fail('Некорректная страница приёмов');
 }
 // Calendar dates are Moscow dates, independent of the browser and DB timezone.
 return {from:new Date(from+'T00:00:00+03:00').toISOString(),to:new Date(Date.parse(to+'T00:00:00+03:00')+86400000).toISOString(),status,limit,after};
}
