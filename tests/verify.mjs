import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rename, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { tournament } from '../src/lib/tournament.js';

await mkdir('artifacts', { recursive: true });
const scratch = await mkdtemp(resolve('artifacts/scratch-'));
const db = resolve(scratch, 'db.json');
const original = await readFile('data/db.json');
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DB_FILE: db, PORT: '3101' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let log = '';
server.stdout.on('data', d => log += d);
server.stderr.on('data', d => log += d);
let browser;
let dev;
const base = 'http://localhost:3101';
const request = async (path, method = 'GET', body, expected = 200) => {
  const response = await fetch(base + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
  return response.json();
};
try {
  for (let i = 0; i < 100; i++) {
    try { await request('/api/state'); break; } catch (e) { if (i === 99) throw new Error(log || e.message); await new Promise(r => setTimeout(r, 100)); }
  }
  await request('/api/contestants', 'POST', null, 400);
  await request('/api/contestants', 'POST', { name: {} }, 400);
  await request('/api/state/extra', 'GET', undefined, 404);
  await request('/api/state', 'POST', {}, 405);
  await request('/api/contestants/missing', 'DELETE', undefined, 404);
  assert.equal((await fetch(base + '/api/contestants', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(base + '/api/contestants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/api/contestants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(11000) }) })).status, 413);
  assert.equal((await fetch(base + '/%2e%2e%2fdata/db.json')).status, 403);
  assert.equal((await fetch(base + '/%E0%A4')).status, 400);
  assert.equal((await fetch(base + '/admin', { method: 'HEAD' })).status, 200);
  await Promise.all(['Aurora', 'Horizonte', 'Norte', 'Cumbre', 'Brisa', 'Estrella', 'Rayo', 'Oceano'].map(name => request('/api/contestants', 'POST', { name, flag: '⚡' }, 201)));
  let state = await request('/api/state');
  assert.equal(state.contestants.length, 8);
  const id = state.contestants[0].id;
  await Promise.all(Array.from({ length: 20 }, () => request('/api/contestants/' + id, 'PATCH', { delta: 1 })));
  state = await request('/api/state');
  assert.equal(state.contestants[0].points, 20);
  assert.deepEqual(JSON.parse(await readFile(db, 'utf8')), state);
  // Force an atomic rename failure; memory and the next transaction must recover.
  await rename(db, db + '.backup');
  await mkdir(db);
  await request('/api/contestants/' + id, 'PATCH', { delta: 1 }, 500);
  assert.deepEqual(await request('/api/state'), state);
  await rmdir(db);
  await rename(db + '.backup', db);
  await request('/api/contestants/' + id, 'PATCH', { delta: Number.MAX_SAFE_INTEGER }, 400);
  await request('/api/picks', 'PUT', { match: '8-0', winner: id }, 400);
  await request('/api/picks', 'PUT', { match: '2-0', winner: id }, 409);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 8 / 2 ** (r + 1); i++) {
    const [winner] = tournament(state.contestants, state.picks).players(r, i);
    state = await request('/api/picks', 'PUT', { match: `${r}-${i}`, winner });
  }
  assert.ok(state.picks['2-0']);
  state = await request('/api/picks', 'PUT', { match: '0-0', winner: null });
  assert.equal(state.picks['1-0'], undefined);
  assert.equal(state.picks['2-0'], undefined);
  state = await request('/api/contestants', 'POST', { name: '<img src=x onerror=alert(1)>', flag: '' }, 201);
  assert.deepEqual(state.picks, {});
  const hostile = state.contestants.at(-1).id;
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  const results = [];
  for (const colorScheme of ['light', 'dark']) for (const width of [1440, 768, 390]) for (const route of ['/', '/admin']) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme });
    await page.goto(base + route);
    await page.locator('#rank tr').first().waitFor();
    assert.equal(await page.locator('#rank img').count(), 0);
    const metrics = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth, bracket: document.querySelector('#bracket').scrollWidth, card: document.querySelector('#bracket').clientWidth }));
    assert.ok(metrics.page <= width, JSON.stringify({ route, width, metrics }));
    if (route === '/') assert.equal(await page.locator('button').count(), 0);
    const name = `${route === '/' ? 'public' : 'admin'}-${width}-${colorScheme}.png`;
    await page.screenshot({ path: resolve('artifacts', name), fullPage: true });
    results.push({ route, width, colorScheme, ...metrics, screenshot: name });
  }
  await page.goto(base + '/admin');
  await page.locator('#rank tr').first().waitFor();
  await page.locator('input[name=name]').fill('Browser contestant');
  // Two synchronous submissions must produce one request/contestant.
  await page.locator('#add').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await page.getByText('Browser contestant', { exact: true }).first().waitFor();
  state = await request('/api/state');
  assert.equal(state.contestants.filter(c => c.name === 'Browser contestant').length, 1);
  await page.getByRole('button', { name: 'Sumar punto a Browser contestant', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('#rank tr')].find(r => r.textContent.includes('Browser contestant'))?.querySelector('.pts').textContent === '1');
  await page.getByRole('button', { name: 'Eliminar a Browser contestant', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#rank').textContent.includes('Browser contestant'));
  await page.goto(base);
  await page.locator('#rank tr').first().waitFor();
  await request('/api/contestants/' + hostile, 'DELETE');
  await page.waitForFunction(() => !document.querySelector('#rank').textContent.includes('<img'), { timeout: 12000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  assert.deepEqual(errors, []);
  dev = spawn(process.execPath, ['node_modules/astro/astro.js', 'dev', '--port', '4322', '--host', '127.0.0.1'], {
    env: { ...process.env, PRESERVE_SYMLINKS: '1', API_PROXY_TARGET: base }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  dev.stdout.on('data', d => log += d);
  dev.stderr.on('data', d => log += d);
  for (let i = 0; i < 150; i++) {
    try {
      const proxied = await fetch('http://127.0.0.1:4322/api/state');
      assert.deepEqual(await proxied.json(), await request('/api/state'));
      break;
    } catch (e) { if (i === 149) throw new Error(log || e.message); await new Promise(r => setTimeout(r, 200)); }
  }
  await writeFile('artifacts/results.json', JSON.stringify({ api: 'passed', browserCrud: 'passed', doubleSubmit: 'passed', polling: 'passed', consoleErrors: errors, screenshots: results }, null, 2));
  console.log('PASS: API validation, concurrent transactions, write failure recovery, picks, browser CRUD, double-submit, polling, reduced motion, dev proxy; 12 screenshots without overflow or console errors.');
} finally {
  await browser?.close();
  if (dev) { dev.kill(); await new Promise(r => dev.exitCode !== null ? r() : dev.once('exit', r)); }
  server.kill();
  await new Promise(r => server.exitCode !== null ? r() : server.once('exit', r));
  assert.deepEqual(await readFile('data/db.json'), original, 'Real database changed');
  console.log('Server stopped; real database unchanged.');
}
