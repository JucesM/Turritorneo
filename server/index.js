// Local / self-hosted server: serves dist/ and the API. On Vercel, api/[...path].js is used instead.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { fileStore, pgStore, fail } from './store.js';
import { apiHandler, send } from './app.js';

const PORT = process.env.PORT || 3001;
const DB = resolve(process.env.DB_FILE ?? fileURLToPath(new URL('../data/db.json', import.meta.url)));
const DIST = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const dbUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const store = dbUrl ? pgStore(neon(dbUrl)) : await fileStore(DB);
const handleApi = apiHandler(store);

async function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); fail(405, 'Método no permitido.'); }
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { fail(400, 'Ruta inválida.'); }
  if (path.includes('\\') || path.includes('\0') || path.split('/').includes('..')) fail(403, 'Ruta no permitida.');
  if (!extname(path)) path = path.replace(/\/$/, '') + '/index.html';
  const file = resolve(DIST, '.' + path);
  if (!file.startsWith(DIST + sep)) fail(403, 'Ruta no permitida.');
  try {
    const actual = await realpath(file);
    if (!actual.startsWith(await realpath(DIST) + sep)) fail(403, 'Ruta no permitida.');
    const data = await readFile(actual);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') fail(404, 'Archivo no encontrado.'); throw e; }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(req, res);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  try { await serveStatic(req, res, url); }
  catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Error del servidor.' });
  }
}).listen(PORT, () => console.log(`Server on :${PORT} (${dbUrl ? 'postgres' : 'file'} storage)`));
