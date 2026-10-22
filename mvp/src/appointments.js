import {dayKey} from './domain.js';
export const appointmentDay=value=>dayKey(new Date(value.startsAt));
export const appointmentDate=value=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'}).format(new Date(value));
export const appointmentTime=value=>new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(value));
export const appointmentStart=(day,time)=>new Date(day+'T'+time+':00+03:00').toISOString();
export const appointmentDayAfter=(day,days)=>new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
export function appointmentDays(value){
 const first=appointmentDay(value),last=dayKey(new Date(Date.parse(value.endsAt)-1));
 return first===last?[first]:[first,last];
}
export function appointmentStatus(value,now=Date.now()){
 if(value.status==='confirmed'&&Date.parse(value.endsAt)<=now)return 'Время приёма прошло';
 if(value.status==='requested'&&Date.parse(value.startsAt)<=now)return 'Время запроса прошло';
 return {requested:'Ожидает подтверждения врача',confirmed:'Приём подтверждён',declined:'Запрос отклонён',cancelled:'Приём отменён'}[value.status]||'Обновите список';
}
