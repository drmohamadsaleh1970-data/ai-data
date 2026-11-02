import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

let srv, db;
before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
});
after(async () => { await srv.close(); });

test('signing up twice returns the same account instead of a duplicate', async () => {
  const c = client(srv.base);
  await c.login('twice-signup');
  const first = await c.post('/api/organizations', { name: 'Twice (TEST)', kind: 'AGENT', terms: true });
  const second = await c.post('/api/organizations', { name: 'Twice (TEST)', kind: 'AGENT', terms: true });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(second.data.id, first.data.id);
  assert.equal(second.data.existing, true);
});

test('owner removes an account from the portal: hidden and login freed, data kept', async () => {
  const c = client(srv.base);
  await c.login('remove-me');
  const org = (await c.post('/api/organizations', { name: 'Remove Me (TEST)', kind: 'AGENT', terms: true })).data;
  const userId = db.prepare("SELECT id FROM platform_user WHERE google_sub = 'fixture|remove-me'").get()?.id
    ?? db.prepare('SELECT owner_user_id AS id FROM organization WHERE id = ?').get(org.id).id;

  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  assert.equal((await o.post(`/api/owner/orgs/${org.id}/remove`, { confirm: 'nope' })).data.error, 'CONFIRMATION_REQUIRED');
  const r = await o.post(`/api/owner/orgs/${org.id}/remove`, { confirm: 'REMOVE ACCOUNT' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.members_removed, 1);

  const dash = (await o.get('/api/owner/dashboard')).data;
  assert.equal(dash.organizations.some((x) => x.id === org.id), false, 'hidden from the portal');
  assert.ok(dash.removed_organizations.some((x) => x.id === org.id), 'still listed as removed');
  assert.ok(db.prepare('SELECT 1 FROM organization WHERE id = ?').get(org.id), 'organization row kept');
  assert.ok(db.prepare('SELECT 1 FROM platform_user WHERE id = ?').get(userId), 'user kept');

  // The same login now has no account and starts a new one.
  const me = (await c.get('/api/me')).data;
  assert.equal(me.memberships.length, 0);
  const fresh = (await c.post('/api/organizations', { name: 'Remove Me again (TEST)', kind: 'AGENT', terms: true })).data;
  assert.notEqual(fresh.id, org.id);
  assert.notEqual(fresh.existing, true);
  assert.equal((await o.post(`/api/owner/orgs/${org.id}/remove`, { confirm: 'REMOVE ACCOUNT' })).data.error, 'ALREADY_REMOVED');
});

test('accounts with a live plan cannot be removed', async () => {
  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  const live = db.prepare("SELECT org_id FROM subscription WHERE status = 'ACTIVE' LIMIT 1").get();
  assert.ok(live, 'fixtures include an active subscription');
  assert.equal((await o.post(`/api/owner/orgs/${live.org_id}/remove`, { confirm: 'REMOVE ACCOUNT' })).data.error, 'HAS_PLAN');
});
