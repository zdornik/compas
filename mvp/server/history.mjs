import {createHmac,timingSafeEqual} from 'node:crypto';
import {dayKey} from '../src/domain.js';

const fail=(message,status=400,code)=>{throw Object.assign(new Error(message),{status,code});};
const kinds={notes:['journal'],observations:['mood','sleep','assessment'],doses:['medication-dose']};
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function historyOptions(params){
  const kind=params.get('kind')||'observations',from=params.get('from'),to=params.get('to'),q=(params.get('q')||'').trim();
  const limit=Number(params.get('limit')||20),before=params.get('before')||null;
  if(!kinds[kind]||!Number.isInteger(limit)||limit<1||limit>100||q.length>200||before?.length>2000)fail('Некорректные параметры истории');
  if(kind!=='notes'&&(!date(from)||!date(to)||to<from||(Date.parse(to)-Date.parse(from))/86400000>61))fail('Выберите период от 1 до 62 дней');
  if(kind==='notes'&&(from||to))fail('Для заметок используется постраничная история');
  if(q&&kind!=='notes')fail('Поиск доступен в заметках');
  return {kind,from:from||null,to:to||null,q,limit,before,since:params.get('since')||null};
}
const mac=(key,value)=>createHmac('sha256',key).update(value).digest('base64url');
const scope=(patient,options)=>JSON.stringify([patient,options.kind,options.from,options.to,options.q]);
export function historyCursor(key,patient,options,value){
  const body=Buffer.from(JSON.stringify(value)).toString('base64url');
  return body+'.'+mac(key,'history-v1:'+scope(patient,options)+':'+body);
}
export function readHistoryCursor(key,patient,options){
  if(!options.before)return null;
  const [body,signature,...extra]=options.before.split('.'),expected=mac(key,'history-v1:'+scope(patient,options)+':'+body);
  if(extra.length||!signature||Buffer.byteLength(signature)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))fail('Страница истории недействительна');
  try{const value=JSON.parse(Buffer.from(body,'base64url'));if(typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at))||typeof value.id!=='string'||value.id.length>80||typeof value.revision!=='string')throw Error();return value;}catch{fail('Страница истории недействительна');}
}
export async function historyRevision(db,patientId){
  const row=(await db.query('SELECT state_revision FROM local_patients WHERE id=$1 FOR SHARE',[patientId])).rows[0];
  if(!row)fail('Профиль не найден',404);
  return dayKey()+':'+row.state_revision;
}
export async function coreEntries(db,patientId,decode){
  // Plans carry their own version history. Never limit this set by diary recency.
  const rows=(await db.query(`SELECT id,payload FROM patient_entries
    WHERE type IN ('medication-plan','medical-profile') OR (observation_day=$1 AND type IN ('mood','sleep','assessment','medication-dose'))
    ORDER BY saved_at DESC,id DESC`,[dayKey()])).rows;
  return rows.map(row=>decode(row,patientId));
}
export async function entryHistory(db,patientId,options,{key,decode,redact=row=>row}){
  const revision=await historyRevision(db,patientId),cursor=readHistoryCursor(key,patientId,options);
  if(cursor&&cursor.revision!==revision)fail('История изменилась. Откройте последние записи.',409,'HISTORY_CHANGED');
  if(!cursor&&options.since===revision)return {unchanged:true,revision};
  const values=[kinds[options.kind]],where=['type=ANY($1::text[])'];
  if(options.from){values.push(options.from,options.to);where.push('observation_day BETWEEN $2::date AND $3::date');}
  if(cursor){values.push(cursor.at,cursor.id);where.push(`(saved_at,id)<($${values.length-1}::timestamptz,$${values.length}::text)`);}
  // Encrypted literal search scans at most 100 rows per request; the cursor advances
  // over scanned rows (including misses). No plaintext index or external search.
  const scanLimit=options.q?100:options.limit;
  values.push(scanLimit+1);
  const rows=(await db.query(`SELECT id,payload,saved_at::text AS cursor_at FROM patient_entries WHERE ${where.join(' AND ')} ORDER BY saved_at DESC,id DESC LIMIT $${values.length}`,values)).rows;
  const entries=[];let scanned=0;
  for(const row of rows.slice(0,scanLimit)){
    scanned++;const entry=redact(decode(row,patientId));
    if(options.q&&!`${entry.title||''}\n${entry.body||''}`.toLocaleLowerCase('ru').includes(options.q.toLocaleLowerCase('ru')))continue;
    entries.push(options.kind==='notes'?{id:entry.id,type:'journal',title:entry.title,day:entry.day,at:entry.at,updatedAt:entry.updatedAt,revision:entry.revision,excerpt:entry.body.slice(0,240)}:entry);
    if(entries.length===options.limit)break;
  }
  const last=rows[scanned-1],more=rows.length>scanned;
  return {entries,revision,nextCursor:more&&last?historyCursor(key,patientId,options,{revision,at:last.cursor_at,id:last.id}):null,scanned};
}
