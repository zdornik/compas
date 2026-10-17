import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { securityHeaders } from '../scripts/security-headers.mjs';
test('application has no health-data persistence or remote submission sinks', async () => {
  const files = (await readdir('src')).filter(f => /\.(jsx|js)$/.test(f));
  const source = (await Promise.all(files.map(f => readFile(`src/${f}`, 'utf8')))).join('\n');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML|sendBeacon|\beval\s*\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
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
