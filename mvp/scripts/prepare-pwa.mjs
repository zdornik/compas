import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { securityHeaders } from './security-headers.mjs';
const root = 'dist/client';
const assets = (await readdir(`${root}/assets`)).filter(f => /\.(js|css)$/.test(f)).map(f => `/assets/${f}`);
const art = (await readdir(`${root}/art`)).filter(f => /\.(webp|png)$/.test(f)).map(f => `/art/${f}`);
const files = ['/index.html', '/manifest.webmanifest', ...assets, ...art];
const hash = createHash('sha256');
for (const file of files) { hash.update(file); hash.update(await readFile(root + file)); }
const version = hash.digest('hex').slice(0, 12);
await writeFile(`${root}/sw.js`, `// Only an explicit list of public application files is cached. Never patient data.
const CACHE = 'compass-shell-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('compass-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!FILES.includes(path)) return;
  event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(path))));
});
`);
const headerLines = Object.entries(securityHeaders).map(([k,v]) => `  ${k}: ${v}`).join('\n');
await writeFile(`${root}/_headers`, `/*\n${headerLines}\n  Strict-Transport-Security: max-age=31536000\n  Cache-Control: no-store\n`);
console.log('PWA: static shell prepared; no personal-data caching.');
