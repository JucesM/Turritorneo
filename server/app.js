// API logic, independent of where it runs (local node:http server or a Vercel function).
import { randomUUID, createHmac, scryptSync, timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import { tournament, prunePicks, BYE } from '../src/lib/tournament.js';
import { fail, MAX_COMPETITIONS, MAX_CONTESTANTS } from './store.js';

const IS_VERCEL = !!process.env.VERCEL;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) throw new Error('Define ADMIN_PASSWORD (min 8 chars)');
// Sessions are signed cookies, so they work across serverless instances. The secret must be stable in production.
const SECRET = process.env.SESSION_SECRET || (IS_VERCEL ? '' : randomBytes(32).toString('hex'));
if (SECRET.length < 32) throw new Error('Define SESSION_SECRET (min 32 chars)');

const SALT = createHash('sha256').update(`tt-salt:${SECRET}`).digest();
const hash = (v) => scryptSync(String(v), SALT, 32);
const USER_HASH = hash(ADMIN_USER), PASS_HASH = hash(ADMIN_PASSWORD);
const SESSION_MS = 8 * 3600e3, COOKIE = 'tt_session';
const sign = (exp) => createHmac('sha256', SECRET).update(String(exp)).digest('hex');
const attempts = new Map(); // ip -> { n, until }. Per-instance: best effort on serverless.

const sessionOk = (req) => {
  const m = /(?:^|;\s*)tt_session=(\d{10,15})\.([0-9a-f]{64})/.exec(req.headers.cookie ?? '');
  if (!m || Number(m[1]) < Date.now()) return false;
  return timingSafeEqual(Buffer.from(sign(m[1])), Buffer.from(m[2]));
};
const setCookie = (res, value, maxAge) => res.setHeader('Set-Cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${IS_VERCEL ? '; Secure' : ''}`);
const clientIp = (req) => (IS_VERCEL ? req.headers['x-forwarded-for']?.split(',')[0].trim() : null) || req.socket.remoteAddress;

export const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') fail(415, 'Se requiere JSON.');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 10000) fail(413, 'Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'JSON inválido.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Se requiere un objeto.');
  return body;
}
const cleanName = (v, label) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 60) fail(400, `${label} inválido.`);
  return v.trim();
};
const summary = (k) => {
  const t = tournament(k.contestants, k.picks), w = k.contestants.length > 1 ? t.winnerOf(t.total - 1, 0) : null;
  return { id: k.id, name: k.name, createdAt: k.createdAt, count: k.contestants.length, champion: w ? k.contestants.find(c => c.id === w)?.name ?? null : null };
};
const findComp = (st, id) => st.competitions.find(k => k.id === id) ?? fail(404, 'Competencia no encontrada.');

async function login(req, res) {
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Origen no permitido.');
  const ip = clientIp(req), a = attempts.get(ip) ?? { n: 0, until: 0 };
  if (a.until > Date.now()) fail(429, 'Demasiados intentos. Espera un minuto.');
  const { user, password } = await readBody(req);
  const ok = timingSafeEqual(hash(user ?? ''), USER_HASH) & timingSafeEqual(hash(password ?? ''), PASS_HASH);
  if (!ok) {
    const n = a.n + 1;
    attempts.set(ip, n >= 5 ? { n: 0, until: Date.now() + 60e3 } : { n, until: 0 });
    fail(401, 'Usuario o contraseña incorrectos.');
  }
  attempts.delete(ip);
  const exp = Date.now() + SESSION_MS;
  setCookie(res, `${exp}.${sign(exp)}`, SESSION_MS / 1000);
  send(res, 200, { admin: true });
}

export async function handleApi(req, res, url, store) {
  const path = url.pathname;
  if (path === '/api/session' && req.method === 'GET') return send(res, 200, { admin: sessionOk(req) });
  if (path === '/api/logout' && req.method === 'POST') { setCookie(res, '', 0); return send(res, 200, { admin: false }); }
  if (path === '/api/login' && req.method === 'POST') return login(req, res);

  const route = /^\/api\/competitions(?:\/([^/]+)(?:\/(contestants(?:\/([^/]+))?|picks))?)?$/.exec(path);
  if (!route) fail(404, 'Ruta no encontrada.');
  const [, cid, sub, pid] = route;
  const kind = !cid ? 'list' : !sub ? 'comp' : sub === 'picks' ? 'picks' : pid ? 'contestant' : 'contestants';
  const allowed = { list: ['GET', 'POST'], comp: ['GET', 'PATCH', 'DELETE'], contestants: ['POST'], contestant: ['PATCH', 'DELETE'], picks: ['PUT'] }[kind];
  if (!allowed.includes(req.method)) { res.setHeader('Allow', allowed.join(', ')); fail(405, 'Método no permitido.'); }
  if (req.method === 'GET') {
    const state = await store.read();
    return send(res, 200, kind === 'list' ? { competitions: state.competitions.map(summary) } : findComp(state, cid));
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Origen no permitido.');
  if (!sessionOk(req)) fail(401, 'Inicia sesión como administrador.');
  const body = req.method === 'DELETE' ? {} : await readBody(req);
  let created;
  const result = await store.mutate(next => {
    if (kind === 'list') {
      if (next.competitions.length >= MAX_COMPETITIONS) fail(409, `Máximo de ${MAX_COMPETITIONS} competencias.`);
      created = { id: randomUUID(), name: cleanName(body.name, 'Nombre'), createdAt: Date.now(), contestants: [], picks: {} };
      next.competitions.push(created);
      return;
    }
    const k = findComp(next, cid);
    if (kind === 'comp') {
      if (req.method === 'DELETE') next.competitions = next.competitions.filter(x => x !== k);
      else k.name = cleanName(body.name, 'Nombre');
    } else if (kind === 'contestants') {
      const { name, flag = '' } = body;
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 40 || typeof flag !== 'string' || flag.trim().length > 8) fail(400, 'Nombre o bandera inválidos.');
      if (k.contestants.length >= MAX_CONTESTANTS) fail(409, `Máximo de ${MAX_CONTESTANTS} concursantes.`);
      k.contestants.push({ id: randomUUID(), name: name.trim(), flag: flag.trim(), points: 0 });
      k.picks = {};
    } else if (kind === 'contestant') {
      const c = k.contestants.find(c => c.id === pid);
      if (!c) fail(404, 'Concursante no encontrado.');
      if (req.method === 'DELETE') { k.contestants = k.contestants.filter(x => x.id !== c.id); k.picks = {}; }
      else {
        if (!Number.isSafeInteger(body.delta) || !Number.isSafeInteger(c.points + body.delta)) fail(400, 'Puntuación inválida.');
        c.points = Math.max(0, c.points + body.delta);
      }
    } else {
      const { match, winner } = body;
      if (typeof match !== 'string' || !/^(0|[1-9]\d*)-(0|[1-9]\d*)$/.test(match)) fail(400, 'Partido inválido.');
      const [r, i] = match.split('-').map(Number);
      const bracket = tournament(k.contestants, k.picks);
      if (k.contestants.length < 2 || r >= bracket.total || i >= bracket.size / 2 ** (r + 1)) fail(400, 'Partido inválido.');
      const players = bracket.players(r, i);
      if (winner === null) delete k.picks[match];
      else {
        if (players.includes(null) || players.includes(BYE) || !players.includes(winner)) fail(409, 'El ganador no participa en este partido. Actualiza la página.');
        k.picks[match] = winner;
      }
      prunePicks(k);
    }
  });
  if (kind === 'list') return send(res, 201, summary(created));
  if (kind === 'comp' && req.method === 'DELETE') return send(res, 200, { ok: true });
  send(res, req.method === 'POST' ? 201 : 200, findComp(result, cid));
}

// Wraps handleApi with the shared security headers and error mapping.
export const apiHandler = (store) => async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  try { await handleApi(req, res, new URL(req.url, 'http://localhost'), store); }
  catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'No se pudo guardar o leer los datos.' });
  }
};
