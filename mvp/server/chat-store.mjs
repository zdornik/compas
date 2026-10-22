import {seal,unseal} from './crypto.mjs';
import {readPatientConsent} from './auth-store.mjs';
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const messageContext=(linkId,id)=>`care-message:${linkId}:${id}`;
export function careMessageInput(input) {
 if(!input||!uuid(input.id))fail('Некорректный идентификатор сообщения');
 if(typeof input.body!=='string')fail('Введите сообщение');
 const body=input.body.replace(/\r\n?/g,'\n').trim();
 if(!body||body.length>6000||Buffer.byteLength(body,'utf8')>24000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body))fail('Сообщение должно содержать от 1 до 6000 символов');
 return {id:input.id.toLowerCase(),body};
}
export function careMessagePage(input={}) {
 const limit=input.limit===undefined?40:Number(input.limit);
 if(!Number.isInteger(limit)||limit<1||limit>100)fail('Некорректный размер страницы');
 let before=null;
 if(input.before!==undefined){
  if(typeof input.before!=='string'||input.before.length>300||!/^[A-Za-z0-9_-]+$/.test(input.before))fail('Некорректная страница сообщений');
  try{before=JSON.parse(Buffer.from(input.before,'base64url').toString('utf8'));}catch{fail('Некорректная страница сообщений');}
  if(!before||!uuid(before.id)||typeof before.at!=='string'||before.at.startsWith('0000')||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(before.at)||!Number.isFinite(Date.parse(before.at))||new Date(before.at).toISOString()!==before.at)fail('Некорректная страница сообщений');
 }
 return {limit,before};
}
const cursor=row=>Buffer.from(JSON.stringify({at:new Date(row.created_at).toISOString(),id:row.id})).toString('base64url');

export function createCareChatStore({transaction,key}) {
 const authorized=(session,linkId,callback,writing=false)=>{
  if(!session?.patient_id||!uuid(linkId))fail('Переписка не найдена',404);
  return transaction(null,async db=>{
   await db.query("SELECT set_config('app.actor_id',$1,true)",[session.patient_id]);
   // Sharing the care-link lock serialises sends/reads with consent revocation.
   let link=(await db.query('SELECT * FROM care_links WHERE id=$1',[linkId])).rows[0];
   if(link){await db.query('SELECT id FROM local_patients WHERE id=$1 FOR UPDATE',[link.patient_id]);link=(await db.query('SELECT * FROM care_links WHERE id=$1 FOR UPDATE',[linkId])).rows[0];}
   if(!link||![link.patient_id,link.doctor_id].includes(session.patient_id))fail('Переписка не найдена',404);
   if(link.status!=='active'||(link.doctor_id===session.patient_id&&!session.doctor_enabled))fail('Переписка недоступна: подключение не активно',403);
   const senderRole=link.patient_id===session.patient_id?'patient':'doctor';
   await db.query("SELECT set_config('app.patient_id',$1,true)",[link.patient_id]);
   const consent=await readPatientConsent(db,link.patient_id,key);
   if(consent.healthData!==true&&(writing||senderRole==='doctor'))fail('Доступ к переписке ограничен настройками согласия пациента',403);
   return callback(db,link,senderRole);
  });
 };
 const view=(row,linkId)=>{
  const payload=unseal(row.payload,key,messageContext(linkId,row.id));
  return {id:row.id,body:payload.body,senderRole:payload.senderRole,createdAt:new Date(row.created_at).toISOString()};
 };
 return {
  async messages(session,linkId,input={}){
   linkId=typeof linkId==='string'?linkId.toLowerCase():linkId;
   const {limit,before}=careMessagePage(input);
   return authorized(session,linkId,async db=>{
    const found=before?await db.query('SELECT id,payload,created_at FROM care_messages WHERE link_id=$1 AND (created_at,id)<($2::timestamptz,$3::uuid) ORDER BY created_at DESC,id DESC LIMIT $4',[linkId,before.at,before.id,limit+1]):await db.query('SELECT id,payload,created_at FROM care_messages WHERE link_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2',[linkId,limit+1]);
    const hasMore=found.rows.length>limit,chunk=found.rows.slice(0,limit);
    return {messages:[...chunk].reverse().map(row=>view(row,linkId)),hasMore,nextBefore:hasMore&&chunk.length?cursor(chunk[chunk.length-1]):null};
   });
  },
  async send(session,linkId,input){
   linkId=typeof linkId==='string'?linkId.toLowerCase():linkId;
   const message=careMessageInput(input);
   return authorized(session,linkId,async(db,link,senderRole)=>{
    const existing=(await db.query('SELECT id,sender_id,payload,created_at FROM care_messages WHERE link_id=$1 AND id=$2',[linkId,message.id])).rows[0];
    if(existing){
     const saved=view(existing,linkId);
     if(existing.sender_id!==session.patient_id||saved.body!==message.body||saved.senderRole!==senderRole)fail('Идентификатор уже занят другим сообщением',409);
     return saved;
    }
    const payload=seal({body:message.body,senderRole},key,messageContext(linkId,message.id));
    const row=(await db.query('INSERT INTO care_messages(link_id,id,sender_id,payload) VALUES($1,$2,$3,$4) RETURNING id,payload,created_at',[linkId,message.id,session.patient_id,payload])).rows[0];
    return view(row,linkId);
   },true);
  },
 };
}
