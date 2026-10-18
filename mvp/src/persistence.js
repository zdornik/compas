import { createContext, useContext } from 'react';
export const PersistenceContext = createContext(false);
export const usePersistentStorage = () => useContext(PersistenceContext);
const csrfTokens={patient:null,doctor:null};
const accountOwners={patient:undefined,doctor:undefined};
const authSource=crypto.randomUUID();
export function authSignalRole(data){return data&&data.type==='auth-changed'&&data.source!==authSource&&['patient','doctor'].includes(data.role)?data.role:null;}
export function setAccountOwner(role,id){accountOwners[role]=id||'local';}
function announceAuthChange(role){if(!('BroadcastChannel' in window))return;const channel=new BroadcastChannel('compass-local-updates');channel.postMessage({type:'auth-changed',role,source:authSource});channel.close();}
async function request(path, options = {}) {
  if (!path.startsWith('/api/')) throw new Error('Недопустимый адрес хранилища');
  const {role='patient',expectedAccount,...requestOptions}=options;let response;
  const identity=expectedAccount??accountOwners[role],unguarded=path==='/api/session'||path==='/api/auth'||/^\/api\/auth\/(login|register)$/.test(path);
  try { response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), ...requestOptions, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Compass-Client': 'web', 'X-Compass-Role':role,...(!unguarded&&identity?{'X-Compass-Account':identity}:{}),...(csrfTokens[role] ? { 'X-CSRF-Token': csrfTokens[role] } : {}), ...requestOptions.headers } }); }
  catch { throw new Error('Нет связи с хранилищем. Изменения остаются в форме — попробуйте сохранить ещё раз'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok){if(data.code==='ACCOUNT_CHANGED'||(response.status===401&&!unguarded))window.dispatchEvent(new CustomEvent('compass-account-mismatch',{detail:role}));throw Object.assign(new Error(data.error||'Не удалось сохранить. Попробуйте ещё раз'),{status:response.status,code:data.code});}
  return data;
}
export async function loadStoredState(expectedAccount) {await loadSession();return request('/api/state',{expectedAccount});}
function announceChange() {
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

export async function loadCare(role='patient') { await loadSession(role); return request('/api/care',{role}); }
const sessionPending={patient:null,doctor:null};
async function loadSession(role='patient') {
 if(csrfTokens[role])return;
 if(sessionPending[role])return sessionPending[role];
 sessionPending[role]=(async()=>{let session;try{session=await request('/api/session',{role});}catch(error){if(error.status!==401)throw error;session=await request('/api/session',{method:'POST',body:'{}',role});}csrfTokens[role]=session.csrfToken;})();
 try{return await sessionPending[role];}finally{sessionPending[role]=null;}
}
export async function changeCare(path,input) {
 if(!path.startsWith('/api/care/'))throw new Error('Недопустимый запрос подключения');
 const role=/^\/api\/care\/(?:doctor|claim|patients)(?:\/|$)/.test(path)?'doctor':'patient';
 await loadSession(role);const result=await request(path,{method:'POST',body:JSON.stringify(input),role});announceChange();return result;
}
export async function loadCarePatient(id) { await loadSession('doctor');return request('/api/care/patients/'+encodeURIComponent(id),{role:'doctor'}); }

// Reference data is public and read-only; this does not open a patient session.
export async function readReference(path, signal) {
  if (!path.startsWith('/api/knowledge/')) throw new Error('Недопустимый адрес справочника');
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: signal || AbortSignal.timeout(20000), headers: { Accept: 'application/json' } }); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('Нет связи со справочником. Попробуйте ещё раз.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось загрузить справочник');
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
export async function loadAuthAccount(role='patient') {await loadSession(role);try{const session=await request('/api/session',{role});csrfTokens[role]=session.csrfToken;}catch(error){if(error.status!==401)throw error;csrfTokens[role]=null;await loadSession(role);}return request('/api/auth',{role});}
export async function authenticateAccount(mode,input){
 if(!['login','register'].includes(mode))throw new Error('Некорректное действие');
 const role=input.role;await loadSession(role);const result=await request('/api/auth/'+mode,{role,method:'POST',body:JSON.stringify(input)});
 csrfTokens[role]=result.csrfToken;announceAuthChange(role);return result;
}
export async function signOutAccount(role='patient'){
 await loadSession(role);const result=await request('/api/auth/logout',{role,method:'POST',body:'{}'});csrfTokens[role]=result.csrfToken||null;announceAuthChange(role);return result;
}
export async function updateAccountConsents(consents,role='patient'){
 await loadSession(role);const result=await request('/api/auth/consents',{role,method:'POST',body:JSON.stringify(consents)});announceChange();return result;
}
