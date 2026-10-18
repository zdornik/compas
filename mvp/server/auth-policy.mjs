import {createHmac,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
export const CONSENT_VERSION='compass-local-2026-10-19-v1';
export const PASSWORD_OPTIONS={N:32768,r:8,p:3,maxmem:64*1024*1024};
export function normalizeLogin(value){
 if(typeof value!=='string'||value.length>254)fail('Введите адрес электронной почты');
 const login=value.trim().toLowerCase();
 if(!/^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/.test(login))fail('Введите адрес электронной почты');
 return login;
}
export const loginHash=(login,key)=>createHmac('sha256',key).update('compass-login\0'+login).digest('hex');
export function validatePassword(password){
 if(typeof password!=='string'||password.length<12||password.length>128||Buffer.byteLength(password,'utf8')>512)fail('Пароль должен содержать от 12 до 128 символов');
 return password;
}
export async function hashPassword(password){
 validatePassword(password);const salt=randomBytes(16),digest=await scrypt(password,salt,32,PASSWORD_OPTIONS);
 return `scrypt-v1:${salt.toString('hex')}:${digest.toString('hex')}`;
}
const DUMMY_HASH='scrypt-v1:69c65c3b3bd0805b289383c2eff4a871:399407c4acaafecdc6b64b217023d89fbcb4b243e19acf9c41a739bd9795b495';
export async function verifyPassword(password,encoded){
 const validInput=typeof password==='string'&&password.length<=128&&Buffer.byteLength(password,'utf8')<=512;
 const match=/^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(encoded||'');
 const chosen=match||/^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(DUMMY_HASH);
 const actual=await scrypt(validInput?password:'invalid-input',Buffer.from(chosen[1],'hex'),32,PASSWORD_OPTIONS);
 return !!match&&validInput&&timingSafeEqual(actual,Buffer.from(chosen[2],'hex'));
}
const name=(value,field)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\x00-\x1f]/.test(value))fail(`Укажите ${field}, до 80 символов`);return value.trim();};
export function validateRegistration(input){
 if(!input||!['patient','doctor'].includes(input.role))fail('Выберите роль');
 const profile={name:name(input.profile?.name,'имя'),surname:name(input.profile?.surname,'фамилию')};
 if(input.role==='patient'){
  if(!Number.isInteger(input.profile?.age)||input.profile.age<1||input.profile.age>120)fail('Укажите возраст от 1 до 120 лет');
  profile.age=input.profile.age;
 }
 if(input.consents?.healthData!==true)fail('Для создания профиля требуется согласие на сохранение и обработку введённых данных');
 for(const key of ['journalProcessing','journalSharing'])if(input.consents?.[key]!==undefined&&typeof input.consents[key]!=='boolean')fail('Проверьте выбранные согласия');
 if(input.consents?.journalSharing===true&&input.consents?.journalProcessing!==true)fail('Доступ врача к личным записям требует согласия на их обработку');
 return {role:input.role,email:normalizeLogin(input.email),password:validatePassword(input.password),profile,consents:{healthData:true,journalProcessing:input.consents?.journalProcessing===true,journalSharing:input.consents?.journalSharing===true}};
}
export function validateConsents(input){
 if(!input||['healthData','journalProcessing','journalSharing'].some(key=>typeof input[key]!=='boolean'))fail('Передайте выбранные согласия');
 if(!input.healthData&&(input.journalProcessing||input.journalSharing))fail('При отзыве обработки данных отзовите также согласия для дневника');
 if(input.journalSharing&&!input.journalProcessing)fail('Доступ врача к личным записям требует согласия на их обработку');
 return {healthData:input.healthData,journalProcessing:input.journalProcessing,journalSharing:input.journalSharing};
}
export function consentUpdate(previous,input,now=new Date()){
 const consents=validateConsents(input);
 if(['healthData','journalProcessing','journalSharing'].every(key=>previous.consents[key]===consents[key]))return null;
 if(input.expectedConsentUpdatedAt!==undefined&&input.expectedConsentUpdatedAt!==previous.consentUpdatedAt)fail('Согласия изменены в другом окне. Обновите настройки перед сохранением',409);
 const at=new Date(Math.max(now.getTime(),Date.parse(previous.consentUpdatedAt)+1)).toISOString();
 return {...previous,consents,consentVersion:CONSENT_VERSION,consentUpdatedAt:at};
}
export function createAuthLimiter({now=Date.now,maxKeys=20000}={}){
 const buckets=new Map();
 return (key,limit=8,windowMs=15*60000)=>{
  const time=now();let bucket=buckets.get(key);
  if(!bucket||bucket.until<=time){bucket={count:0,until:time+windowMs};buckets.delete(key);buckets.set(key,bucket);}
  if(buckets.size>maxKeys){for(const [id,value]of buckets)if(value.until<=time)buckets.delete(id);while(buckets.size>maxKeys)buckets.delete(buckets.keys().next().value);}
  bucket.count++;return bucket.count<=limit;
 };
}
