import { timingSafeEqual,createHash } from 'node:crypto';
import { createStore } from './store.mjs';
import {createAuthLimiter} from './auth-policy.mjs';
const equal = (a = '', b = '') => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createApi({store:providedStore,siteOrigin}={}) {
  const store = providedStore||await createStore();
  const origin = siteOrigin||process.env.SITE_ORIGIN || 'http://127.0.0.1:4174';
  const expectedHost = new URL(origin).host;
  const secure = origin.startsWith('https:');
  const sessionCookie = process.env.SESSION_COOKIE_NAME || 'compass_session';
  if(!/^[a-z][a-z0-9_]{1,48}$/.test(sessionCookie))throw new Error('Invalid session cookie name');
  const buckets = new Map();
  const authAllowed=createAuthLimiter();
  const cookieValue=(req,name)=>req.headers.cookie?.split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='))?.slice(name.length+1);
  const cookie=(name,value,maxAge=2592000)=>`${name}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure?'; Secure':''}`;
  const rateAllowed = key => {
    const now = Date.now();
    if (buckets.size > 1000) for (const [id, bucket] of buckets) if (bucket.until < now) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket || bucket.until < now) { bucket = { count: 0, until: now + 60000 }; buckets.set(key, bucket); }
    return ++bucket.count <= 120;
  };
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const readBody = req => new Promise((resolve, reject) => {
    if (!req.headers['content-type']?.startsWith('application/json')) { reject(Object.assign(new Error('Требуется JSON'), { status: 415 })); req.resume(); return; }
    let size = 0, chunks = [], rejected = false;
    req.on('data', chunk => { size += chunk.length; if (size > 100000) { rejected = true; chunks = []; reject(Object.assign(new Error('Запись слишком большая'), { status: 413 })); } else if (!rejected) chunks.push(chunk); });
    req.on('end', () => { if (!rejected) try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Некорректный JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
  return async (req, res, pathname) => {
    try {
      if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') { json(res, 403, { error: 'Запрос из другого источника запрещён' }); return; }
      if (pathname === '/api/health' && req.method === 'GET') { await store.health(); json(res, 200, { status: 'ok' }); return; }
      if (pathname.startsWith('/api/knowledge/')) {
        if (!rateAllowed(req.socket.remoteAddress)) { json(res, 429, { error: 'Слишком много запросов. Попробуйте немного позже' }); return; }
        await store.reference(req, res, pathname); return;
      }
      const role=req.headers['x-compass-role']==='doctor'?'doctor':'patient';
      const cookieName=role==='doctor'?sessionCookie+'_doctor':sessionCookie;
      const token = cookieValue(req,cookieName);
      const session = await store.session(token);
      if (!rateAllowed(session ? token : req.socket.remoteAddress)) { json(res, 429, { error: 'Слишком много запросов. Попробуйте немного позже' }); return; }
      if (pathname === '/api/session' && req.method === 'POST') {
        req.resume();
        if (req.headers.origin !== origin || req.headers['x-compass-client'] !== 'web') { json(res, 403, { error: 'Недопустимый запрос профиля' }); return; }
        if (session) { json(res, 200, { csrfToken: session.csrf_token }); return; }
        const created = await store.createSession();
        res.setHeader('Set-Cookie', cookie(cookieName,created.token));
        json(res, 201, { csrfToken: created.csrfToken }); return;
      }
      if(pathname==='/api/auth'&&req.method==='GET'){json(res,200,await store.auth.current(session));return;}
      if (!session) { json(res, 401, { error: 'Локальный профиль не открыт' }); return; }
      if(session.account_role&&session.account_role!==role){json(res,403,{error:'Выбранная роль не соответствует аккаунту'});return;}
      const identityHint=req.headers['x-compass-account'];
      if(identityHint!==undefined&&pathname!=='/api/session'&&!['/api/auth/login','/api/auth/register'].includes(pathname)&&identityHint!==(session.account_id||'local')){json(res,409,{error:'Учётная запись изменилась. Откройте её заново.',code:'ACCOUNT_CHANGED'});return;}
      if(pathname.startsWith('/api/auth/')&&req.method==='POST'){
        if(req.headers.origin!==origin||req.headers['x-compass-client']!=='web'||!equal(req.headers['x-csrf-token'],session.csrf_token)){json(res,403,{error:'Проверка запроса не пройдена. Обновите страницу'});return;}
        const input=await readBody(req);
        if(pathname==='/api/auth/register'||pathname==='/api/auth/login'){
          const address=req.socket.remoteAddress||'local',loginKey=createHash('sha256').update(String(input?.email||'').trim().toLowerCase()).digest('hex');
          const action=pathname.endsWith('/register')?'register':'login';
          if(!authAllowed(action+':ip:'+address,action==='register'?10:40,action==='register'?3600000:900000)||!authAllowed(action+':login:'+loginKey,8,900000)){json(res,429,{error:'Слишком много попыток входа. Попробуйте позже'});return;}
          if(input?.role!==role){json(res,422,{error:'Выберите ту же роль, что указана в форме'});return;}
          const created=action==='register'?await store.auth.register(input):await store.auth.login(input);
          const cookies=[cookie(cookieName,created.token)];
          if(!session.account_id)cookies.push(cookie(cookieName+'_local',token));
          res.setHeader('Set-Cookie',cookies);
          json(res,action==='register'?201:200,{csrfToken:created.csrfToken,account:created.account});return;
        }
        if(pathname==='/api/auth/logout'){
          await store.auth.logout(session);
          const localToken=cookieValue(req,cookieName+'_local'),local=await store.session(localToken);
          res.setHeader('Set-Cookie',cookie(cookieName,local&&!local.account_id?localToken:'',local&&!local.account_id?2592000:0));
          json(res,200,{signedOut:true,csrfToken:local&&!local.account_id?local.csrf_token:null});return;
        }
        if(pathname==='/api/auth/consents'){json(res,200,await store.auth.consents(session,input));return;}
        json(res,404,{error:'Неизвестный запрос'});return;
      }
      if (pathname === '/api/session' && req.method === 'GET') { json(res, 200, { csrfToken: session.csrf_token }); return; }
      if (pathname === '/api/state' && req.method === 'GET') { json(res, 200, await store.state(session.patient_id)); return; }
      if (pathname === '/api/care' && req.method === 'GET') { json(res, 200, await store.care.links(session)); return; }
      const careArchive=pathname.match(/^\/api\/care\/patients\/([a-f0-9-]{36})\/medications\/([a-f0-9-]{36})\/archive$/i);
      const carePatient = pathname.match(/^\/api\/care\/patients\/([a-f0-9-]{36})(?:\/(check|prescriptions|medical-profile))?$/i);
      const careMessages=pathname.match(/^\/api\/care\/links\/([a-f0-9-]{36})\/messages$/i);
      if(careMessages&&req.method==='GET'){
        if(session.account_role==='doctor')await store.auth.requireHealthConsent(session);
        const params=new URL(req.url,origin).searchParams;
        json(res,200,await store.chat.messages(session,careMessages[1],{before:params.get('before')||undefined,limit:params.get('limit')||undefined}));return;
      }
      if (carePatient && req.method === 'GET' && !carePatient[2]) { await store.auth.requireHealthConsent(session);json(res, 200, await store.care.patient(session, carePatient[1])); return; }
      if (pathname.startsWith('/api/care') && req.method === 'POST') {
        if (req.headers.origin !== origin || !equal(req.headers['x-csrf-token'], session.csrf_token)) { json(res,403,{error:'Проверка запроса не пройдена. Обновите страницу'}); return; }
        const input = await readBody(req);
        const consent = pathname.match(/^\/api\/care\/links\/([a-f0-9-]{36})$/i);
        if(!consent)await store.auth.requireHealthConsent(session);
        if(session.account_role==='patient'&&(pathname==='/api/care/doctor'||pathname==='/api/care/claim'||carePatient||careArchive)){json(res,403,{error:'Для этого действия требуется аккаунт врача'});return;}
        if(session.account_role==='doctor'&&(pathname==='/api/care/profile'||pathname==='/api/care/invites'||consent)){json(res,403,{error:'Для этого действия требуется аккаунт пациента'});return;}
        if(careMessages)json(res,200,await store.chat.send(session,careMessages[1],input));
        else if (pathname === '/api/care/doctor') json(res,200,await store.care.doctor(session,input.name));
        else if (pathname === '/api/care/profile') json(res,200,await store.care.profile(session,input.name));
        else if (pathname === '/api/care/invites') json(res,201,await store.care.invite(session,input.name));
        else if (pathname === '/api/care/claim') json(res,201,await store.care.claim(session,input.code));
        else if (consent) json(res,200,await store.care.consent(session,consent[1],input.status));
        else if(careArchive)json(res,200,await store.care.archiveMedication(session,careArchive[1],careArchive[2],input));
        else if (carePatient?.[2] === 'check') json(res,200,await store.care.check(session,carePatient[1],input));
        else if (carePatient?.[2] === 'prescriptions') json(res,200,await store.care.prescribe(session,carePatient[1],input));
        else if (carePatient?.[2] === 'medical-profile') json(res,200,await store.care.medicalProfile(session,carePatient[1],input));
        else json(res,404,{error:'Неизвестный запрос'});
        return;
      }
      if (req.method === 'PUT') {
        if (req.headers.origin !== origin || !equal(req.headers['x-csrf-token'], session.csrf_token)) { json(res, 403, { error: 'Проверка запроса не пройдена. Обновите страницу' }); return; }
        const entry = pathname.match(/^\/api\/entries\/([a-zA-Z0-9-]{1,80})$/);
        const dose = pathname.match(/^\/api\/doses\/(one|two)$/);
        if (entry || dose) {
          if(session.account_role==='doctor'){json(res,403,{error:'Собственные записи создаются в аккаунте пациента'});return;}
          await store.auth.requireHealthConsent(session);
          const input = await readBody(req);
          try { json(res, 200, entry ? await store.saveEntry(session.patient_id, entry[1], input) : await store.dose(session.patient_id, dose[1], input.status)); }
          catch (error) { if (error.code || error.message === 'Invalid encrypted record') throw error; json(res, error.status || 422, { error: error.message }); }
          return;
        }
      }
      json(res, 404, { error: 'Неизвестный запрос' });
    } catch (error) { json(res, error.status || 503, { error: error.status ? error.message : 'Хранилище недоступно. Запись не сохранена — повторите попытку' }); }
  };
}
