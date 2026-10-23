import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {seal} from '../server/crypto.mjs';
import {dayKey} from '../src/domain.js';
import {addDays,medicationDraft,makeMedicationPlan} from '../src/medications.js';

export async function seedSyntheticHistory(store,{notes=500,days=365,plans=1}={}){
  assert.match(process.env.DB_NAME||'',/^compass_journal_qa_[a-f0-9]+$/);
  const password='Synthetic-browser-2026!',accounts={};
  for(const role of ['patient','doctor']){
    const email='history-'+role+'-'+randomUUID()+'@example.invalid';
    const result=await store.auth.register({role,email,password,profile:{name:'Проверка',surname:role==='patient'?'Истории':'Врач',...(role==='patient'?{age:30}:{})},consents:{healthData:true}});
    accounts[role]={...result,email,password,session:await store.session(result.token)};
  }
  const patient=accounts.patient.session.patient_id,today=dayKey(),rows=[],planIds=Array.from({length:plans},()=>randomUUID());
  for(let i=0;i<notes;i++){
    const day=addDays(today,-i),at=day+'T12:00:00.000Z';
    rows.push({id:'history-note-'+i,type:'journal',title:'Запись истории '+i,body:'Синтетический текст. '.repeat(950)+(i===notes-1?' Искомый архивный текст.':''),day,at,createdAt:at,updatedAt:at,revision:1});
  }
  for(let i=0;i<days;i++)for(const type of ['mood','sleep']){
    const day=addDays(today,-i),at=day+'T13:00:00.000Z';
    rows.push({id:'history-'+type+'-'+i,type,day,at,createdAt:at,updatedAt:at,...(type==='mood'?{kind:'moment',value:3,words:[],factors:[],note:'Старый личный текст'}:{hours:7,minutes:30,quality:'Хорошо'})});
  }
  for(let i=0;i<plans;i++)rows.push(makeMedicationPlan({...medicationDraft(),name:'Синтетическая схема '+i,strength:1,quantity:1,startDate:addDays(today,-500-i)},planIds[i]));
  const key=Buffer.from((await readFile(process.env.DATA_KEY_FILE,'utf8')).trim(),'base64');
  const admin=new pg.Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME,user:'compass_admin',password:(await readFile(process.env.ADMIN_DB_PASSWORD_FILE,'utf8')).trim()});
  try{
    await admin.connect();await admin.query('BEGIN');
    for(let i=0;i<rows.length;i+=100){
      const batch=rows.slice(i,i+100).map(row=>({id:row.id,type:row.type,day:row.day,payload:seal(row,key,patient+':'+row.id).toString('base64'),at:row.updatedAt||row.at}));
      await admin.query(`INSERT INTO patient_entries(patient_id,id,type,observation_day,payload,saved_at)
        SELECT $1,id,type,day::date,decode(payload,'base64'),at::timestamptz FROM jsonb_to_recordset($2::jsonb) AS x(id text,type text,day text,payload text,at text)`,[patient,JSON.stringify(batch)]);
    }
    await admin.query('COMMIT');
  }finally{await admin.end();}
  const profile=await store.care.profile(accounts.patient.session),link=await store.care.claim(accounts.doctor.session,profile.code);
  await store.care.consent(accounts.patient.session,link.id,'active');
  return {accounts,linkId:link.id,notes,days,plans,planIds,oldDay:addDays(today,1-days)};
}
