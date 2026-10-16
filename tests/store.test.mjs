// Logic check for the Postgres store using an in-memory fake of the `sql` tagged template.
// Run: node tests/store.test.mjs
import assert from 'node:assert/strict';
import { pgStore } from '../server/store.js';

function fakeSql() {
  let row = null; // { value, version }
  const sql = async (strings, ...v) => {
    const q = strings.join('?');
    await new Promise((r) => setTimeout(r, Math.random() * 5)); // let concurrent callers interleave
    if (q.startsWith('CREATE TABLE')) return [];
    if (q.startsWith('SELECT')) return row ? [{ value: structuredClone(row.value), version: row.version }] : [];
    if (q.startsWith('INSERT')) { if (row) return []; row = { value: JSON.parse(v[1]), version: 1 }; return [{ version: 1 }]; }
    if (q.startsWith('UPDATE')) { if (!row || row.version !== v[2]) return []; row = { value: JSON.parse(v[0]), version: row.version + 1 }; return [{ version: row.version }]; }
    throw new Error('unexpected query ' + q);
  };
  return sql;
}

const store = pgStore(fakeSql());
assert.deepEqual(await store.read(), { competitions: [] });
// 10 concurrent writers must all land, none lost (optimistic retry)
await Promise.all(Array.from({ length: 10 }, (_, i) => store.mutate((s) => s.competitions.push({ id: 'c' + i, name: 'n' + i, createdAt: 1, contestants: [], picks: {} }))));
assert.equal((await store.read()).competitions.length, 10);
// a throwing mutation must not write
await assert.rejects(store.mutate(() => { throw Object.assign(new Error('x'), { status: 400 }); }));
assert.equal((await store.read()).competitions.length, 10);
console.log('store tests PASS');
