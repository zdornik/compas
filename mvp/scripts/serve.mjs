import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { securityHeaders } from './security-headers.mjs';
const root = resolve('dist/client');
const api = process.env.DB_HOST ? await (await import('../server/api.mjs')).createApi() : null;
const port = Number(process.env.PORT || 4174);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
createServer(async (req, res) => {
  for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
  res.setHeader('Cache-Control', 'no-store');
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      if (api) await api(req, res, pathname);
      else { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Database is not connected' })); }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('\\')) { res.writeHead(404); res.end(); return; }
    let file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep)) { res.writeHead(404); res.end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404); res.end(); return; }
    const encodings = (req.headers['accept-encoding'] || '').split(',').map(item => { const [name, quality] = item.trim().split(';q='); return { name, quality: quality === undefined ? 1 : Number(quality) }; });
    const encoding = ['br', 'gzip'].find(name => encodings.some(item => item.name === name && item.quality > 0));
    let body;
    if (encoding && /\.(html|mjs|js|css|json|webmanifest|svg)$/.test(file)) {
      try { body = await readFile(file + (encoding === 'br' ? '.br' : '.gz')); res.setHeader('Content-Encoding', encoding); res.setHeader('Vary', 'Accept-Encoding'); }
      catch { /* Older local builds may not have compressed siblings. */ }
    }
    body ||= await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Length', body.length);
    res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Компас: http://127.0.0.1:${port}/`));
