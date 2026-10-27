import { createContext, useContext } from 'react';
import {pollingResources} from './polling-resource.js';
export const PersistenceContext = createContext(false);
export const AccountOwnersContext=createContext({patient:'local',doctor:'local'});
export const usePersistentStorage = () => useContext(PersistenceContext);
const csrfTokens={patient:null,doctor:null};
const csrfRefreshes={patient:null,doctor:null};
const authEpoch={patient:0,doctor:0};
const staleAuth=()=>Object.assign(new Error('Учётная запись изменилась. Повторите загрузку.'),{code:'STALE_AUTH_REFRESH'});
const accountOwners={patient:undefined,doctor:undefined};
const authSource=crypto.randomUUID();
export function authSignalRole(data){return data&&data.type==='auth-changed'&&data.source!==authSource&&['patient','doctor'].includes(data.role)?data.role:null;}
export function setAccountOwner(role,id){const next=id||'local';if(accountOwners[role]!==next)pollingResources.clearRole(role);accountOwners[role]=next;}
function announceAuthChange(role){pollingResources.clearRole(role);if(!('BroadcastChannel' in window))return;const channel=new BroadcastChannel('compass-local-updates');channel.postMessage({type:'auth-changed',role,source:authSource});channel.close();}
async function request(path, options = {}) {
  if (!path.startsWith('/api/')) throw new Error('Недопустимый адрес хранилища');
  const {role='patient',expectedAccount,csrfRetried=false,...requestOptions}=options;let response;
  const epoch=authEpoch[role],owner=accountOwners[role],sentCsrf=csrfTokens[role];
  const identity=expectedAccount??accountOwners[role],unguarded=path==='/api/session'||path==='/api/auth'||/^\/api\/auth\/(login|register)$/.test(path);
  const timeout=AbortSignal.timeout(15000),signal=requestOptions.signal?AbortSignal.any([timeout,requestOptions.signal]):timeout;
  try { response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...requestOptions, signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Compass-Client': 'web', 'X-Compass-Role':role,...(!unguarded&&identity?{'X-Compass-Account':identity}:{}),...(sentCsrf ? { 'X-CSRF-Token': sentCsrf } : {}), ...requestOptions.headers } }); }
  catch(error) { if(requestOptions.signal?.aborted)throw error;throw new Error('Нет связи с хранилищем. Изменения остаются в форме — попробуйте сохранить ещё раз'); }
  const data = await response.json().catch(() => ({}));
  if(response.status===403&&data.code==='CSRF_INVALID'&&!csrfRetried&&!['GET','HEAD'].includes(requestOptions.method||'GET')){
    if(epoch!==authEpoch[role]||owner!==accountOwners[role])throw staleAuth();
    if(csrfTokens[role]===sentCsrf)await refreshCsrf(role,epoch,owner);
    if(epoch!==authEpoch[role]||owner!==accountOwners[role])throw staleAuth();
    // The API rejects CSRF before performing a mutation. Keep the original owner and body.
    return request(path,{...options,expectedAccount:identity,csrfRetried:true});
  }
  if (!response.ok){if(data.code==='ACCOUNT_CHANGED'||(response.status===401&&!unguarded))window.dispatchEvent(new CustomEvent('compass-account-mismatch',{detail:role}));throw Object.assign(new Error(data.error||'Не удалось сохранить. Попробуйте ещё раз'),{status:response.status,code:data.code,retryAfterMs:Math.max(0,Number(response.headers.get('Retry-After'))||0)*1000});}
  return data;
}
async function refreshCsrf(role,epoch,owner){
  if(csrfRefreshes[role]?.epoch===epoch&&csrfRefreshes[role].owner===owner)return csrfRefreshes[role].promise;
  const refresh={epoch,owner};
  refresh.promise=(async()=>{
    const session=await request('/api/session',{role});
    if(epoch!==authEpoch[role]||owner!==accountOwners[role])throw staleAuth();
    csrfTokens[role]=session.csrfToken;
  })();
  csrfRefreshes[role]=refresh;
  try{return await refresh.promise;}
  catch(error){
    if(error.status===401&&epoch===authEpoch[role]&&owner===accountOwners[role]){csrfTokens[role]=null;window.dispatchEvent(new CustomEvent('compass-account-mismatch',{detail:role}));}
    throw error;
  }finally{if(csrfRefreshes[role]===refresh)csrfRefreshes[role]=null;}
}
export async function loadStoredState(expectedAccount,since) {await loadSession();return request('/api/state'+(since?'?since='+encodeURIComponent(since):''),{expectedAccount});}
export async function loadEntry(id,signal){return request('/api/entries/'+encodeURIComponent(id),{signal});}
export async function loadEntryHistory(params,linkId,signal){return request((linkId?'/api/care/patients/'+encodeURIComponent(linkId):'/api')+'/history?'+new URLSearchParams(params),{role:linkId?'doctor':'patient',signal});}
function announceChange() {
  pollingResources.refreshAll();
  if (!('BroadcastChannel' in window)) return;
  const channel = new BroadcastChannel('compass-local-updates');
  // Invalidation only. No diary text, answers, scores or identifiers leave the API client.
  channel.postMessage('changed'); channel.close();
}
export async function storeEntry(entry,expectedAccount) {
  const saved = await request(`/api/entries/${encodeURIComponent(entry.id)}`, {method:'PUT',body:JSON.stringify(entry),expectedAccount});
  announceChange(); return saved;
}
export async function storeDose(id, status) {
  const saved = await request(`/api/doses/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status }) });
  announceChange(); return saved;
}

export async function loadCare(role='patient',signal) { await loadSession(role); return request('/api/care',{role,signal}); }
const sessionPending={patient:null,doctor:null};
async function loadSession(role='patient') {
 if(csrfTokens[role])return;
 if(sessionPending[role])return sessionPending[role];
 const epoch=authEpoch[role];
 sessionPending[role]=(async()=>{let session;try{session=await request('/api/session',{role});}catch(error){if(epoch!==authEpoch[role])throw staleAuth();if(error.status!==401)throw error;session=await request('/api/session',{method:'POST',body:'{}',role});}if(epoch!==authEpoch[role])throw staleAuth();csrfTokens[role]=session.csrfToken;})();
 try{return await sessionPending[role];}finally{sessionPending[role]=null;}
}
export async function changeCare(path,input) {
 if(!path.startsWith('/api/care/'))throw new Error('Недопустимый запрос подключения');
 const role=/^\/api\/care\/(?:doctor|claim|patients)(?:\/|$)/.test(path)?'doctor':'patient';
 await loadSession(role);const result=await request(path,{method:'POST',body:JSON.stringify(input),role});announceChange();return result;
}
export async function loadCarePatient(id) { await loadSession('doctor');return request('/api/care/patients/'+encodeURIComponent(id),{role:'doctor'}); }
export async function loadCareRoster(params,signal){await loadSession('doctor');return request('/api/care/roster?'+new URLSearchParams(params),{role:'doctor',signal});}
export async function clinicalNotesRequest(linkId,{body,params={},signal}={}){
  if(!/^[a-f0-9-]{36}$/i.test(linkId))throw Error('Некорректное подключение');
  await loadSession('doctor');const result=await request('/api/care/patients/'+linkId+'/clinical-notes?'+new URLSearchParams(params),{role:'doctor',signal,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  if(body)announceChange();return result;
}

// Reference data is public and read-only; this does not open a patient session.
export async function readReference(path, signal) {
  if (!path.startsWith('/api/knowledge/')) throw new Error('Недопустимый адрес справочника');
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', cache: 'default', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), headers: { Accept: 'application/json' } }); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('Нет связи со справочником. Попробуйте ещё раз.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Не удалось загрузить справочник'),{status:response.status});
  return data;
}

// Messages stay in the encrypted care store; drafts never enter browser storage.
export async function loadCareMessages(linkId,{before,limit=40,role='patient'}={}) {
 await loadSession(role);const query=new URLSearchParams({limit:String(limit)});if(before)query.set('before',before);
 return request('/api/care/links/'+encodeURIComponent(linkId)+'/messages?'+query,{role});
}
export async function sendCareMessage(linkId,input,role='patient') {
 await loadSession(role);const saved=await request('/api/care/links/'+encodeURIComponent(linkId)+'/messages',{role,method:'POST',body:JSON.stringify(input)});
 announceChange();return saved;
}

// Account changes rotate the role session; credentials are never persisted in the browser.
export async function loadAuthAccount(role='patient') {const epoch=authEpoch[role];await loadSession(role);if(epoch!==authEpoch[role])throw staleAuth();try{const session=await request('/api/session',{role});if(epoch!==authEpoch[role])throw staleAuth();csrfTokens[role]=session.csrfToken;}catch(error){if(epoch!==authEpoch[role])throw staleAuth();if(error.status!==401)throw error;csrfTokens[role]=null;await loadSession(role);}if(epoch!==authEpoch[role])throw staleAuth();return request('/api/auth',{role});}
export async function authenticateAccount(mode,input){
 if(!['login','register'].includes(mode))throw new Error('Некорректное действие');
 const role=input.role;await loadSession(role);const result=await request('/api/auth/'+mode,{role,method:'POST',body:JSON.stringify(input)});
 authEpoch[result.account.role]++;csrfTokens[result.account.role]=result.csrfToken;announceAuthChange(result.account.role);return result;
}
export async function signOutAccount(role='patient'){
 await loadSession(role);const result=await request('/api/auth/logout',{role,method:'POST',body:'{}'});authEpoch[role]++;csrfTokens[role]=result.csrfToken||null;announceAuthChange(role);return result;
}
export async function updateAccountConsents(consents,role='patient'){
 await loadSession(role);const result=await request('/api/auth/consents',{role,method:'POST',body:JSON.stringify(consents)});announceChange();return result;
}

export async function journalRequest(path,{role='patient',method='GET',body,signal}={}){
 if(!/^\/api\/(?:journal\/|care\/(?:alerts(?:\/|\?|$)|patients\/[a-f0-9-]+\/notes(?:\/|\?|$)))/i.test(path))throw new Error('Недопустимый адрес заметок');
 await loadSession(role);
 const result=await request(path,{role,method,...(body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});
 if(method!=='GET')announceChange();return result;
}

export async function appointmentRequest(path,{role='patient',method='GET',body,signal}={}){
 if(!/^\/api\/appointments(?:\?|$|\/[a-f0-9-]{36}\/(?:confirm|decline|cancel)$)/i.test(path))throw new Error('Недопустимый адрес приёмов');
 await loadSession(role);
 const result=await request(path,{role,method,...(body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});
 if(method!=='GET')announceChange();return result;
}
