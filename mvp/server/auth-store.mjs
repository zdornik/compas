import {syncJournalAccess} from './journal-store.mjs';
import {cancelAccessAppointments} from './appointment-store.mjs';
import {randomUUID,randomBytes} from 'node:crypto';
import {seal,unseal,tokenHash} from './crypto.mjs';
import {CONSENT_VERSION,normalizeLogin,loginHash,hashPassword,verifyPassword,validateRegistration,validateConsents,consentUpdate} from './auth-policy.mjs';
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
export const accountView=(row,key)=>{
 const data=unseal(row.payload,key,'auth-account:'+row.id);
 return {id:row.id,role:row.role,email:data.email,emailVerified:false,profile:data.profile,consents:data.consents,consentVersion:data.consentVersion,consentUpdatedAt:data.consentUpdatedAt,localPrototype:true};
};
export async function readPatientConsent(db,patientId,key){
 const account=(await db.query('SELECT id,payload FROM auth_accounts WHERE principal_id=$1 FOR SHARE',[patientId])).rows[0];
 if(!account)return {healthData:true,journalProcessing:false,journalSharing:false};
 return unseal(account.payload,key,'auth-account:'+account.id).consents;
}
export function createAuthStore({transaction,key}){
 const actor=(db,id)=>db.query("SELECT set_config('app.actor_id',$1,true)",[id]);
 const session=async(db,account)=>{
  const token=randomBytes(32).toString('hex'),csrfToken=randomBytes(32).toString('hex');
  await db.query("INSERT INTO app_sessions(token_hash,patient_id,csrf_token,expires_at,doctor_enabled,account_id) VALUES($1,$2,$3,now()+interval '30 days',$4,$5)",[tokenHash(token),account.principal_id,csrfToken,account.role==='doctor',account.id]);
  return {token,csrfToken,account:accountView(account,key)};
 };
 const consentEvent=async(db,account,consents,at)=>{
  const id=randomUUID();await db.query('INSERT INTO auth_consent_events(id,account_id,principal_id,payload) VALUES($1,$2,$3,$4)',[id,account.id,account.principal_id,seal({consents,version:CONSENT_VERSION,at},key,'auth-consent:'+id)]);
 };
 return {
  async register(input){
   const value=validateRegistration(input),passwordHash=await hashPassword(value.password),principalId=randomUUID(),accountId=randomUUID(),at=new Date().toISOString();
   const payload={email:value.email,profile:value.profile,consents:value.consents,consentVersion:CONSENT_VERSION,consentUpdatedAt:at};
   try{return await transaction(principalId,async db=>{
    await actor(db,principalId);await db.query('INSERT INTO local_patients(id) VALUES($1)',[principalId]);
    const account=(await db.query('INSERT INTO auth_accounts(id,principal_id,login_hash,role,password_hash,payload) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[accountId,principalId,loginHash(value.email,key),value.role,passwordHash,seal(payload,key,'auth-account:'+accountId)])).rows[0];
    const name=value.profile.name+' '+value.profile.surname;
    if(value.role==='doctor')await db.query('INSERT INTO care_doctors(id,payload) VALUES($1,$2)',[principalId,seal({name},key,'doctor:'+principalId)]);
    else{const code=randomBytes(6).toString('hex').toUpperCase();await db.query('INSERT INTO care_patient_profiles(patient_id,code_hash,payload) VALUES($1,$2,$3)',[principalId,tokenHash(code),seal({name,code},key,'patient-profile:'+principalId)]);}
    await syncJournalAccess(db,principalId,value.consents);await consentEvent(db,account,value.consents,at);return session(db,account);
   });}catch(error){if(error.code==='23505')fail('Не удалось создать аккаунт с указанными данными. Попробуйте войти или используйте другой адрес',409);throw error;}
  },
  async login(input){
   let email;try{email=normalizeLogin(input?.email);}catch{await verifyPassword(input?.password,null);fail('Не удалось войти. Проверьте данные и выбранную роль',401);}
   if(!['patient','doctor'].includes(input?.role)){await verifyPassword(input?.password,null);fail('Не удалось войти. Проверьте данные и выбранную роль',401);}
   return transaction(null,async db=>{
    await db.query("SELECT set_config('app.login_hash',$1,true)",[loginHash(email,key)]);
    let account;
    if(input.discoverRole===true){
     const candidates=(await db.query('SELECT * FROM auth_accounts WHERE login_hash=$1',[loginHash(email,key)])).rows;
     // Verify both fixed roles, including missing accounts, before choosing a session.
     for(const role of [input.role,input.role==='patient'?'doctor':'patient']){
      const candidate=candidates.find(row=>row.role===role);
      const valid=await verifyPassword(input.password,candidate?.password_hash);
      if(valid&&!account)account=candidate;
     }
    }else{
     const candidate=(await db.query('SELECT * FROM auth_accounts WHERE login_hash=$1 AND role=$2',[loginHash(email,key),input.role])).rows[0];
     if(await verifyPassword(input.password,candidate?.password_hash))account=candidate;
    }
    if(!account)fail('Не удалось войти. Проверьте почту и пароль',401);
    await actor(db,account.principal_id);return session(db,account);
   });
  },
  async current(current){
   if(!current?.account_id)return {account:null};
   return transaction(current.patient_id,async db=>{await actor(db,current.patient_id);const account=(await db.query('SELECT * FROM auth_accounts WHERE id=$1 AND principal_id=$2',[current.account_id,current.patient_id])).rows[0];return {account:account?accountView(account,key):null};});
  },
  async logout(current){if(current)await transaction(null,db=>db.query('UPDATE app_sessions SET expires_at=now() WHERE token_hash=$1',[current.token_hash]));return {signedOut:true};},
  async consents(current,input){
   if(!current.account_id)fail('Сначала войдите в аккаунт',401);const consents=validateConsents(input);
   return transaction(current.patient_id,async db=>{
    await db.query('SELECT id FROM local_patients WHERE id=$1 FOR UPDATE',[current.patient_id]);
    await actor(db,current.patient_id);const account=(await db.query('SELECT * FROM auth_accounts WHERE id=$1 AND principal_id=$2 FOR UPDATE',[current.account_id,current.patient_id])).rows[0];if(!account)fail('Аккаунт не найден',401);
    const previous=unseal(account.payload,key,'auth-account:'+account.id),next=consentUpdate(previous,input);if(!next)return {account:accountView(account,key)};
    account.payload=seal(next,key,'auth-account:'+account.id);
    if(!consents.healthData)await cancelAccessAppointments(db,current.patient_id,key);
    await db.query('UPDATE auth_accounts SET payload=$2,updated_at=now() WHERE id=$1',[account.id,account.payload]);await syncJournalAccess(db,current.patient_id,consents);await consentEvent(db,account,consents,next.consentUpdatedAt);
    return {account:accountView(account,key)};
   });
  },
  async requireHealthConsent(current){
   if(!current?.account_id)return;
   const view=await this.current(current);if(view.account?.consents.healthData!==true)fail('Согласие на обработку данных отозвано. Изменить его можно в настройках',403);
  },
 };
}
