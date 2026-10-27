import {createHmac,timingSafeEqual} from 'node:crypto';
import {seal,unseal} from './crypto.mjs';
import {validEntryDate} from '../src/domain.js';
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export const CLINICAL_NOTE_TYPES=['anamnesis','psychotherapy','consultation'];
export const THERAPY_METHODS=['unspecified','cbt','gestalt','other'];
export function clinicalNoteInput(input){
 if(!input||!uuid(input.id)||!Number.isInteger(input.expectedRevision)||input.expectedRevision<0)fail('Проверьте запись и её версию');
 if(!CLINICAL_NOTE_TYPES.includes(input.kind)||!THERAPY_METHODS.includes(input.method||'unspecified'))fail('Выберите тип записи и подход');
 if(typeof input.title!=='string'||input.title.trim().length>120||typeof input.body!=='string'||!input.body.trim()||input.body.length>20000)fail('Заполните комментарий до 20 000 символов');
 if(!validEntryDate(input.day,new Date()))fail('Выберите дату не позднее сегодняшней');
 return {id:input.id,kind:input.kind,method:input.method||'unspecified',title:input.title.trim(),body:input.body.trim(),day:input.day};
}
const context=(link,doctor,id,revision)=>`clinical-note:${link}:${doctor}:${id}:${revision}`;
const signature=(key,scope,body)=>createHmac('sha256',key).update('clinical-notes-v1:'+scope+':'+body).digest('base64url');
export function clinicalNotePage(params,key,scope){
 const limit=Number(params.get('limit')||20),before=params.get('before');
 if(!Number.isInteger(limit)||limit<1||limit>50||before?.length>1000)fail('Некорректная страница',400);
 if(!before)return {limit,cursor:null};
 const [body,mac,...extra]=before.split('.'),expected=signature(key,scope,body);
 if(extra.length||!mac||Buffer.byteLength(mac)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))fail('Страница недействительна',400);
 try{const cursor=JSON.parse(Buffer.from(body,'base64url'));if(!uuid(cursor.id)||!Number.isFinite(Date.parse(cursor.at)))throw Error();return {limit,cursor};}catch{fail('Страница недействительна',400);}
}
export async function listClinicalNotes(db,link,session,params,key){
 const scope=link.id+':'+session.patient_id,{limit,cursor}=clinicalNotePage(params,key,scope);
 const rows=(await db.query(`SELECT *,updated_at::text AS cursor_at FROM care_clinical_notes WHERE link_id=$1 AND doctor_id=$2 AND ($3::timestamptz IS NULL OR (updated_at,id)<($3::timestamptz,$4::uuid)) ORDER BY updated_at DESC,id DESC LIMIT $5`,[link.id,session.patient_id,cursor?.at||null,cursor?.id||null,limit+1])).rows;
 const selected=rows.slice(0,limit),last=selected.at(-1),body=last?Buffer.from(JSON.stringify({at:last.cursor_at,id:last.id})).toString('base64url'):null;
 return {items:selected.map(row=>({...unseal(row.payload,key,context(link.id,session.patient_id,row.id,row.revision)),revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at})),nextCursor:rows.length>limit?body+'.'+signature(key,scope,body):null,privateToDoctor:true};
}
export async function saveClinicalNote(db,link,session,input,key){
 const value=clinicalNoteInput(input),row=(await db.query('SELECT * FROM care_clinical_notes WHERE id=$1 FOR UPDATE',[value.id])).rows[0];
 if(row&&(row.link_id!==link.id||row.doctor_id!==session.patient_id))fail('Запись не найдена',404);
 const previous=row?unseal(row.payload,key,context(link.id,session.patient_id,row.id,row.revision)):null;
 if(previous&&['kind','method','title','body','day'].every(field=>previous[field]===value[field]))return {...previous,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};
 if(input.expectedRevision!==(row?.revision||0))fail('Комментарий изменён в другом окне. Загрузите актуальную версию',409);
 const revision=(row?.revision||0)+1,payload=seal(value,key,context(link.id,session.patient_id,value.id,revision));
 const saved=(await db.query(`INSERT INTO care_clinical_notes(id,link_id,patient_id,doctor_id,revision,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=now() RETURNING created_at,updated_at`,[value.id,link.id,link.patient_id,session.patient_id,revision,payload])).rows[0];
 await db.query('INSERT INTO care_clinical_note_versions(note_id,revision,link_id,doctor_id,payload) VALUES($1,$2,$3,$4,$5)',[value.id,revision,link.id,session.patient_id,payload]);
 return {...value,revision,createdAt:saved.created_at,updatedAt:saved.updated_at};
}
