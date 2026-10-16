// Persistence. Same interface for both backends: read() -> state, mutate(fn) -> new state.
//  - Postgres (DATABASE_URL, e.g. Neon on Vercel): one jsonb row + optimistic version check.
//  - JSON file (local dev): serialized queue + atomic rename.
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export const MAX_COMPETITIONS = 100, MAX_CONTESTANTS = 64;
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

const validComp = (k) => k && typeof k.id === 'string' && typeof k.name === 'string' && k.picks && typeof k.picks === 'object' && !Array.isArray(k.picks) &&
  Array.isArray(k.contestants) && k.contestants.length <= MAX_CONTESTANTS && new Set(k.contestants.map(c => c?.id)).size === k.contestants.length &&
  k.contestants.every(c => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.flag === 'string' && Number.isSafeInteger(c.points) && c.points >= 0);

// Accepts the current shape or the legacy single-tournament file; throws on corrupt data.
export function normalize(raw) {
  const state = Array.isArray(raw?.competitions) ? raw
    : { competitions: [{ id: randomUUID(), name: 'Torneo 1', createdAt: Date.now(), contestants: raw?.contestants, picks: raw?.picks }] };
  if (state.competitions.length > MAX_COMPETITIONS || !state.competitions.every(validComp)) throw new Error('Invalid database');
  return state;
}

export async function fileStore(file) {
  let state = { competitions: [] };
  try { state = normalize(JSON.parse(await readFile(file, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let queue = Promise.resolve();
  return {
    read: async () => state,
    // A transaction publishes its snapshot only after the atomic rename succeeds.
    mutate(fn) {
      const op = queue.then(async () => {
        const next = structuredClone(state);
        fn(next);
        await mkdir(dirname(file), { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        try { await writeFile(temp, JSON.stringify(next, null, 2), { flag: 'wx' }); await rename(temp, file); }
        finally { await rm(temp, { force: true }); }
        state = next;
        return next;
      });
      queue = op.catch(() => {});
      return op;
    },
  };
}

// `sql` is a tagged-template query function returning rows (e.g. neon(url)). Injectable for tests.
export function pgStore(sql) {
  const KEY = 'state', RETRIES = 10;
  let ready;
  const init = () => (ready ??= sql`CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, value jsonb NOT NULL, version integer NOT NULL DEFAULT 0)`);
  const load = async () => {
    await init();
    const [row] = await sql`SELECT value, version FROM kv WHERE key = ${KEY}`;
    return row ? { state: normalize(row.value), version: row.version } : { state: { competitions: [] }, version: null };
  };
  return {
    read: async () => (await load()).state,
    async mutate(fn) {
      // Optimistic concurrency: write only if nobody changed the row since we read it; otherwise re-read and retry.
      for (let i = 0; i < RETRIES; i++) {
        const { state, version } = await load();
        const next = structuredClone(state);
        fn(next);
        const json = JSON.stringify(next);
        const rows = version === null
          ? await sql`INSERT INTO kv (key, value, version) VALUES (${KEY}, ${json}::jsonb, 1) ON CONFLICT (key) DO NOTHING RETURNING version`
          : await sql`UPDATE kv SET value = ${json}::jsonb, version = version + 1 WHERE key = ${KEY} AND version = ${version} RETURNING version`;
        if (rows.length) return next;
        await new Promise((r) => setTimeout(r, Math.random() * 15 * (i + 1))); // jittered backoff
      }
      fail(409, 'Hubo cambios simultáneos. Intenta de nuevo.');
    },
  };
}
