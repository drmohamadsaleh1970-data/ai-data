import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each test file gets its own fresh SQLite file with reference data and, unless turned
// off, FICTIONAL fixtures (test/fixtures.js). By default the app is built with the
// test-only sign-in (createApp({ testLogin: true })), which production never enables.
export async function startTestServer({ fixtures = true, testLogin = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aihome-test-'));
  process.env.DB_FILE = path.join(dir, 'test.db');
  process.env.EXPORT_DIR = path.join(dir, 'exports');
  const { getDb } = await import('../server/db.js');
  const { seedBase, ensureOwner } = await import('../server/seed.js');
  const { seedFixtures } = await import('./fixtures.js');
  const { createApp } = await import('../server/app.js');
  getDb();
  seedBase();
  ensureOwner();
  const ids = fixtures ? seedFixtures({ investors: 400 }) : null;
  const server = createApp({ testLogin }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, server, ids, dbFile: process.env.DB_FILE, close: () => new Promise((r) => server.close(r)) };
}

// Minimal cookie-jar client that behaves like the browser SPA (CSRF header included).
export function client(base) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-aihome-csrf': '1', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const [pair] = c.split(';');
      const [k] = pair.split('=');
      cookie = [...cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')), pair].join('; ');
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b = {}, h) => call('POST', u, b, h),
    patch: (u, b = {}, h) => call('PATCH', u, b, h),
    del: (u, h) => call('DELETE', u, undefined, h),
    login: async (persona) => { const r = await call('POST', '/api/test/login', { persona }); if (r.status !== 200) throw new Error('login failed ' + persona); return r; },
    mfa: async () => { const { data } = await call('GET', '/api/test/totp'); return call('POST', '/api/me/mfa/verify', { code: data.code }); },
  };
}

export const key = () => 'test-' + Math.random().toString(36).slice(2) + Date.now();

export async function eligibleIds(c, filter = {}, n = 25) {
  const out = [];
  let cursor = null;
  while (out.length < n) {
    const { data } = await c.post('/api/cold/search', { filter, cursor, limit: 50 });
    out.push(...data.results.filter((r) => !r.acquired && !r.blocked_reason).map((r) => r.id));
    if (!data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out.slice(0, n);
}
