import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

// Automatic distribution of AI-DATA Hot pool leads: when the owner turns it on, each new
// pool lead goes, in turn, to the next customer (agency or solo agent) with Hot credits.
let srv, db, ids, owner;
const inquiry = (n, siteKey = 'pool-test-site') => fetch(srv.base + '/api/public/inquiry', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-site-key': siteKey, 'x-forwarded-for': `10.0.0.${n}` },
  body: JSON.stringify({ full_name: `Pool Person ${n} (TEST)`, phone: `05077700${String(n).padStart(2, '0')}`, consent_contact: true, area: 'Dubai Marina', client_event_id: `pool-${n}` }),
}).then(async (r) => ({ status: r.status, data: await r.json() }));
const poolRow = (n) => db.prepare('SELECT * FROM hot_lead_pool WHERE full_name = ?').get(`Pool Person ${n} (TEST)`);
const hotLeads = (orgId) => db.prepare("SELECT COUNT(*) AS n FROM crm_lead WHERE org_id = ? AND source_detail = 'AIHOME_HOT_ALLOCATION'").get(orgId).n;

before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
  ids = srv.ids;
  owner = client(srv.base);
  await owner.login('owner');
  await owner.mfa();
});
after(() => srv.close());

test('switch is off by default: pool leads wait for the owner', async () => {
  const h = (await owner.get('/api/owner/hot')).data;
  assert.equal(h.auto_distribute, false);
  assert.deepEqual(h.queue, []);
  const r = await inquiry(1);
  assert.equal(r.data.destination, 'AIHOME_HOT_POOL');
  assert.equal(poolRow(1).allocated_org_id, null);
});

test('without approved pricing nothing is distributed, even when switched on', async () => {
  assert.equal((await owner.post('/api/owner/flags', { key: 'HOT_AUTO_DISTRIBUTE', enabled: true })).status, 200);
  await inquiry(2);
  assert.equal(poolRow(2).allocated_org_id, null);
  assert.equal((await owner.post('/api/owner/hot/distribute')).data.error, 'OWNER_CONFIGURATION_REQUIRED');
});

test('switched on: new leads are shared in turn among customers with credits, then wait when credits run out', async () => {
  assert.equal((await owner.post('/api/owner/hot/pricing', { model: 'PER_LEAD', price_aed: 150 })).status, 200);
  assert.equal((await owner.post('/api/owner/hot/entitlements', { org_id: ids.agency, credits: 2 })).status, 200);
  assert.equal((await owner.post('/api/owner/hot/entitlements', { org_id: ids.soloOrg, credits: 1 })).status, 200);
  const queue = (await owner.get('/api/owner/hot')).data.queue;
  assert.deepEqual(queue.map((q) => q.org_id).sort(), [ids.agency, ids.soloOrg].sort());

  const r3 = await inquiry(3);
  assert.deepEqual(Object.keys(r3.data).sort(), ['accepted', 'destination', 'pool_id'], 'the visitor is not told which customer got the lead');
  await inquiry(4);
  await inquiry(5);
  await inquiry(6);
  const to = [3, 4, 5, 6].map((n) => poolRow(n).allocated_org_id);
  assert.deepEqual(to.slice(0, 3).sort(), [ids.agency, ids.agency, ids.soloOrg].sort(), 'agency 2 credits, solo 1 credit');
  assert.notEqual(to[0], to[1], 'shared in turn: two different customers first');
  assert.equal(to[3], null, 'no credits left: lead waits in the pool');
  for (const n of [3, 4, 5]) assert.equal(poolRow(n).allocation_method, 'AUTO');

  assert.equal(hotLeads(ids.agency), 2);
  assert.equal(hotLeads(ids.soloOrg), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hot_lead_billing_ledger WHERE pool_id IN (?,?,?)").get(poolRow(3).id, poolRow(4).id, poolRow(5).id).n, 3);
  const autoAudit = db.prepare("SELECT actor_user_id FROM audit_log WHERE action = 'HOT_LEAD_AUTO_ALLOCATED'").all();
  assert.equal(autoAudit.length, 3);
  assert.ok(autoAudit.every((a) => a.actor_user_id == null), 'recorded as automatic');
  const soloLead = db.prepare("SELECT assigned_user_id, first_contact_due FROM crm_lead WHERE org_id = ? AND source_detail = 'AIHOME_HOT_ALLOCATION'").get(ids.soloOrg);
  assert.ok(soloLead.assigned_user_id && soloLead.first_contact_due, 'assigned with a first-contact deadline');
  assert.deepEqual((await owner.get('/api/owner/hot')).data.queue, [], 'queue empty when credits are used up');
  // Cold quota untouched.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM quota_ledger').get().n, 0);
});

test('"Distribute waiting leads now" shares leads already in the pool, oldest first', async () => {
  assert.equal((await owner.post('/api/owner/hot/entitlements', { org_id: ids.soloOrg, credits: 2 })).status, 200);
  const r = (await owner.post('/api/owner/hot/distribute')).data;
  assert.equal(r.allocated, 2);
  assert.equal(r.by_org[ids.soloOrg], 2);
  assert.equal(poolRow(1).allocated_org_id, ids.soloOrg, 'oldest waiting lead first');
  assert.equal(poolRow(2).allocated_org_id, ids.soloOrg);
  assert.equal(poolRow(6).allocated_org_id, null, 'credits ran out again');
  assert.equal(r.still_waiting, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'HOT_POOL_DISTRIBUTED'").get().n, 1);
});

test('manual allocation still works and is marked Manual; switching off stops automatic sharing', async () => {
  assert.equal((await owner.post('/api/owner/hot/entitlements', { org_id: ids.agency, credits: 5 })).status, 200);
  assert.equal((await owner.post(`/api/owner/hot/pool/${poolRow(6).id}/allocate`, { org_id: ids.agency })).status, 200);
  assert.equal(poolRow(6).allocation_method, 'MANUAL');
  assert.equal((await owner.post('/api/owner/flags', { key: 'HOT_AUTO_DISTRIBUTE', enabled: false })).status, 200);
  await inquiry(7);
  assert.equal(poolRow(7).allocated_org_id, null, 'off again: lead waits');
});

test('an agency website key still goes straight to that agency, never through the pool', async () => {
  await owner.post('/api/owner/flags', { key: 'HOT_AUTO_DISTRIBUTE', enabled: true });
  const r = await inquiry(8, 'marinacrest-test-site');
  assert.equal(r.data.destination, 'AGENCY_CRM');
  assert.equal(poolRow(8), undefined);
});

test('only the platform owner can switch it or distribute', async () => {
  for (const persona of ['director', 'solo', 'finance']) {
    const c = client(srv.base);
    await c.login(persona);
    assert.equal((await c.post('/api/owner/hot/distribute')).status, 403, persona);
    assert.equal((await c.post('/api/owner/flags', { key: 'HOT_AUTO_DISTRIBUTE', enabled: true })).status, 403, persona);
  }
  const fresh = client(srv.base);
  await fresh.login('owner');
  assert.equal((await fresh.post('/api/owner/flags', { key: 'HOT_AUTO_DISTRIBUTE', enabled: false })).data.error, 'MFA_REQUIRED', 'turning it on or off needs the authenticator code');
});
