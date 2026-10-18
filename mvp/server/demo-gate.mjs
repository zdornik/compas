import { createServer, request as proxyRequest } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { securityHeaders } from '../scripts/security-headers.mjs';

const digest = value => createHash('sha256').update(value).digest();
const cookieValue = header => header?.split(';').map(v => v.trim()).find(v => v.startsWith('compass_demo='))?.slice(13);
const loginPage = error => `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Компас · доступ к прототипу</title><style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#edf3ef;color:#243d34;font:16px/1.6 system-ui,sans-serif;padding:24px}main{width:min(430px,100%);padding:40px 30px;background:#fbfdfb;border:1px solid #dce7df;border-radius:28px}.brand{font-size:27px;letter-spacing:-1px}h1{font-size:24px;font-weight:550;line-height:1.3;margin:38px 0 14px}p{color:#6e7e74;font-size:14px}label{display:block;margin:26px 0 9px;font-size:13px}input,button{font:inherit;width:100%;border-radius:16px;min-height:50px}input{border:1px solid #cbdcd1;background:#fff;padding:12px 15px}button{margin-top:14px;border:0;border-radius:99px;background:#376e59;color:white;cursor:pointer}small{display:block;margin-top:26px;color:#7d8e82;font-size:12px}.error{color:#924b3a}input:focus-visible,button:focus-visible{outline:3px solid #87ad9c;outline-offset:3px}</style><main><div class="brand">компас</div><h1>Пространство для знакомства</h1><p>Введите код, который вам передали вместе со ссылкой.</p>${error ? '<p class="error" role="alert">Код не подошёл. Попробуйте ещё раз.</p>' : ''}<form method="post" action="/__demo/login"><label for="code">Код доступа</label><input id="code" name="code" type="password" required maxlength="80" autocomplete="off"><button>Открыть прототип</button></form><small>Только вымышленные данные. Это демонстрация интерфейса, а не медицинская помощь. У каждого браузера свой тестовый дневник.</small></main></html>`;

export function createDemoGate({ origin, upstream, accessCode, now = Date.now }) {
  if (!origin?.startsWith('https://') || !accessCode || accessCode.length < 16) throw new Error('HTTPS origin and a strong demo code are required');
  const host = new URL(origin).host, destination = new URL(upstream);
  const codeHash = digest(accessCode), sessions = new Map(), attempts = new Map();
  const lifetime = 8 * 60 * 60 * 1000;
  const send = (res, status, body, type = 'text/html; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
  const server = createServer(async (req, res) => {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    res.setHeader('Content-Security-Policy', securityHeaders['Content-Security-Policy'].replace("form-action 'none'", "form-action 'self'"));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Strict-Transport-Security', 'max-age=86400');
    let path;
    try { path = new URL(req.url, origin).pathname; }
    catch { req.resume(); send(res, 400, 'Bad request', 'text/plain'); return; }
    if (path === '/__demo/health' && req.method === 'GET') { send(res, 200, '{"status":"ok"}', 'application/json'); return; }
    if (req.headers.host !== host) { req.resume(); send(res, 403, 'Forbidden', 'text/plain'); return; }
    const forwardedProtocol = req.headers['x-forwarded-proto']?.split(',')[0].trim();
    if (forwardedProtocol && forwardedProtocol !== 'https') {
      req.resume();
      if (['GET','HEAD'].includes(req.method)) { res.writeHead(308,{Location:origin+path}); res.end(); }
      else send(res,403,'HTTPS required','text/plain');
      return;
    }
    // Native form POSTs can serialize Origin as "null" under no-referrer.
    // Keep it for the same-origin login; upstream app pages stay no-referrer.
    if (path === '/__demo/login') res.setHeader('Referrer-Policy', 'same-origin');
    if (path === '/__demo/login' && req.method === 'GET') { send(res, 200, loginPage(false)); return; }
    if (path === '/__demo/login' && req.method === 'POST') {
      if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') { req.resume(); send(res, 403, 'Forbidden', 'text/plain'); return; }
      if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) { req.resume(); send(res, 415, 'Unsupported', 'text/plain'); return; }
      const time = now();
      for (const [id, item] of attempts) if (item.until < time) attempts.delete(id);
      for (const [id, until] of sessions) if (until < time) sessions.delete(id);
      // localhost.run appends the connecting address to X-Forwarded-For.
      // Never accept a visitor-supplied Cloudflare header as their identity.
      const ip = req.headers['x-forwarded-for']?.split(',').at(-1).trim() || req.socket.remoteAddress;
      let bucket = attempts.get(ip);
      if (!bucket) { if (attempts.size >= 2048) { req.resume(); send(res, 429, 'Try later', 'text/plain'); return; } bucket = { count: 0, until: time + 15 * 60 * 1000 }; attempts.set(ip, bucket); }
      if (++bucket.count > 12) { req.resume(); res.setHeader('Retry-After', '900'); send(res, 429, 'Слишком много попыток. Попробуйте позже.', 'text/plain; charset=utf-8'); return; }
      let body = '', oversized = false;
      try {
        for await (const chunk of req) { if (body.length + chunk.length > 1024) { oversized = true; } else if (!oversized) body += chunk; }
      } catch { send(res, 400, 'Bad request', 'text/plain'); return; }
      if (oversized) { send(res, 413, 'Too large', 'text/plain'); return; }
      const candidate = new URLSearchParams(body).get('code') || '';
      if (!timingSafeEqual(digest(candidate), codeHash)) { send(res, 401, loginPage(true)); return; }
      if (sessions.size >= 512) { send(res, 503, 'Попробуйте позже', 'text/plain; charset=utf-8'); return; }
      const token = randomBytes(32).toString('base64url');
      sessions.set(digest(token).toString('hex'), time + lifetime);
      res.setHeader('Set-Cookie', `compass_demo=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);
      res.writeHead(303, { Location: '/' }); res.end(); return;
    }
    const token = cookieValue(req.headers.cookie), until = token && sessions.get(digest(token).toString('hex'));
    if (!until || until <= now()) {
      req.resume();
      if (path.startsWith('/api/')) { send(res, 401, '{"error":"Откройте прототип по коду доступа"}', 'application/json; charset=utf-8'); return; }
      res.writeHead(303, { Location: '/__demo/login' }); res.end(); return;
    }
    if (!['GET', 'HEAD', 'POST', 'PUT'].includes(req.method)) { req.resume(); send(res, 405, 'Method not allowed', 'text/plain'); return; }
    // Forward only the app cookie. The shared gate never supplies a patient ID.
    const headers = { ...req.headers, host, cookie: req.headers.cookie?.split(';').map(v => v.trim()).filter(v => v.startsWith('compass_session=')).join('; ') || '' };
    delete headers.connection; delete headers['proxy-authorization']; delete headers['transfer-encoding'];
    const upstreamRequest = proxyRequest({ hostname: destination.hostname, port: destination.port || 80, path: req.url, method: req.method, headers, timeout: 20000 }, upstreamResponse => {
      for (const [name, value] of Object.entries(upstreamResponse.headers)) if (value !== undefined && !['connection', 'transfer-encoding', 'cache-control'].includes(name)) res.setHeader(name, value);
      res.setHeader('Cache-Control', 'private, no-store');
      res.writeHead(upstreamResponse.statusCode); upstreamResponse.pipe(res);
    });
    upstreamRequest.on('timeout', () => upstreamRequest.destroy());
    upstreamRequest.on('error', () => { if (!res.headersSent) send(res, 502, 'Прототип временно недоступен', 'text/plain; charset=utf-8'); else res.destroy(); });
    req.on('aborted', () => upstreamRequest.destroy()); req.pipe(upstreamRequest);
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxConnections = 256;
  return server;
}
