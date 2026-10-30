import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Acceptance test 4: two agents of the same AGENT_MONTHLY account (99/day) each submit
// 70 distinct new records at the same moment from separate threads with separate DB
// connections. Committed transfers must never exceed 99.
test('concurrent transfers never exceed the shared daily allowance', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aihome-conc-'));
  process.env.DB_FILE = path.join(dir, 'c.db');
  const { getDb } = await import('../server/db.js');
  const { seedBase, seedDemo } = await import('../server/seed.js');
  const db = getDb();
  seedBase();
  const { soloOrg } = seedDemo({ investors: 400 });
  const soloOwner = db.prepare('SELECT owner_user_id FROM organization WHERE id = ?').get(soloOrg).owner_user_id;
  // Second member of the same paying account.
  const second = db.prepare("SELECT id FROM platform_user WHERE google_sub = 'demo|newuser'").get().id;
  db.prepare("INSERT INTO membership (org_id, user_id, role, created_at) VALUES (?,?,'AGENT',?)").run(soloOrg, second, new Date().toISOString());
  const ids = db.prepare("SELECT id FROM investor_contact WHERE rights_status='APPROVED' AND suppressed=0 ORDER BY id LIMIT 140").all().map((r) => r.id);
  db.close();

  const workerSrc = `
    const { workerData, parentPort } = require('node:worker_threads');
    (async () => {
      process.env.DB_FILE = workerData.file;
      const { openDb, setDb } = await import(workerData.dbUrl);
      setDb(openDb(workerData.file));
      const { transfer } = await import(workerData.coldUrl);
      const sab = new Int32Array(workerData.barrier);
      Atomics.add(sab, 0, 1);
      while (Atomics.load(sab, 0) < 2) {}
      try {
        const r = transfer({ membership: workerData.membership, selection: { mode: 'ids', ids: workerData.ids }, idempotencyKey: workerData.key, allowPartial: true });
        parentPort.postMessage({ charged: r.charged });
      } catch (e) { parentPort.postMessage({ error: e.code || e.message }); }
    })();`;
  const barrier = new SharedArrayBuffer(4);
  const url = (p) => new URL(p, import.meta.url).href;
  const run = (membership, slice, k) => new Promise((resolve, reject) => {
    const w = new Worker(workerSrc, { eval: true, workerData: { file: process.env.DB_FILE, dbUrl: url('../server/db.js'), coldUrl: url('../server/cold.js'), barrier, membership, ids: slice, key: k } });
    w.once('message', resolve);
    w.once('error', reject);
  });
  const [a, b] = await Promise.all([
    run({ org_id: soloOrg, user_id: soloOwner, role: 'ORG_OWNER' }, ids.slice(0, 70), 'conc-key-a-0001'),
    run({ org_id: soloOrg, user_id: second, role: 'AGENT' }, ids.slice(70, 140), 'conc-key-b-0001'),
  ]);
  assert.ok(!a.error && !b.error, JSON.stringify({ a, b }));
  assert.equal(a.charged + b.charged, 99, `charged ${a.charged} + ${b.charged}`);

  const { openDb } = await import('../server/db.js');
  const check = openDb(process.env.DB_FILE);
  const q = check.prepare('SELECT SUM(committed_used) AS used FROM daily_quota_account WHERE org_id = ?').get(soloOrg);
  const grants = check.prepare('SELECT COUNT(*) AS n FROM record_acquisition_grant WHERE org_id = ?').get(soloOrg);
  const contacts = check.prepare('SELECT COUNT(*) AS n FROM crm_contact WHERE org_id = ?').get(soloOrg);
  assert.equal(q.used, 99);
  assert.equal(grants.n, 99);
  assert.equal(contacts.n, 99);
});
