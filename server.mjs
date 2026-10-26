// Minimal static server for the app (no dependencies). Also answers /api/exists?url=... for syllabus PDFs,
// which the browser cannot check itself because info.braude.ac.il sends no CORS headers.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const existsCache = new Map();
const SYLLABUS_RE = /^https:\/\/info\.braude\.ac\.il\/info\/\d{4}\/\d{7}\.pdf$/;

async function syllabusExists(url) {
  if (!SYLLABUS_RE.test(url)) return null;
  if (!existsCache.has(url)) {
    const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
    existsCache.set(url, !!res && res.ok && (res.headers.get('content-type') || '').includes('pdf'));
  }
  return existsCache.get(url);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/pdf') {
    // Same-origin copy of a syllabus PDF so pdf.js can render it inside the page.
    const target = url.searchParams.get('url') || '';
    if (!SYLLABUS_RE.test(target)) { res.writeHead(400); return res.end(); }
    const upstream = await fetch(target).catch(() => null);
    if (!upstream?.ok) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'max-age=86400' });
    return res.end(Buffer.from(await upstream.arrayBuffer()));
  }
  if (url.pathname === '/api/exists') {
    const exists = await syllabusExists(url.searchParams.get('url') || '');
    res.writeHead(exists === null ? 400 : 200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ exists }));
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('לא נמצא'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`בונה המערכת רץ בכתובת: http://localhost:${PORT}`);
});
