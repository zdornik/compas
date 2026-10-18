import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { securityHeaders } from '../scripts/security-headers.mjs';
test('browser stores no health data and only the isolated same-origin client makes API requests', async () => {
  const files = (await readdir('src')).filter(f => /\.(jsx|js)$/.test(f));
  const source = (await Promise.all(files.map(f => readFile(`src/${f}`, 'utf8')))).join('\n');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML|sendBeacon|\beval\s*\(/);
  const withoutClient = (await Promise.all(files.filter(f => f !== 'persistence.js').map(f => readFile(`src/${f}`, 'utf8')))).join('\n');
  assert.doesNotMatch(withoutClient, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  const client = await readFile('src/persistence.js', 'utf8');
  assert.match(client, /credentials: 'same-origin'/); assert.match(client, /cache: 'no-store'/);
  assert.match(client, /X-CSRF-Token/); assert.doesNotMatch(client, /https?:\/\//);
});
test('production CSP restricts scripts and embedding and disables sensitive browser APIs', () => {
  const csp = securityHeaders['Content-Security-Policy'];
  assert.match(csp, /script-src 'self';/); assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /form-action 'none'/);
  assert.equal(securityHeaders['X-Content-Type-Options'], 'nosniff');
  assert.match(securityHeaders['Permissions-Policy'], /microphone=\(\)/);
});
test('compiled service worker only handles exact static allowlisted paths', async () => {
  const source = await readFile('dist/client/sw.js', 'utf8');
  assert.match(source, /!FILES.includes\(path\)/); assert.match(source, /url.origin !== self.location.origin/);
  assert.match(source, /event.request.method !== 'GET'/); assert.match(source, /url.search/);
  assert.doesNotMatch(source, /\/api\/|\/patient\/|\/messages\//);
});
