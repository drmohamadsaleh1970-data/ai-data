import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

let srv, db, marina;
before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
});
after(async () => { await srv.close(); });

test('agency search lists agencies by name only (no agent accounts, no owner CRM)', async () => {
  const c = client(srv.base);
  assert.deepEqual((await c.get('/api/public/agencies?q=m')).data, [], 'at least 2 characters');
  const found = (await c.get('/api/public/agencies?q=marina')).data;
  assert.equal(found.length, 1);
  assert.deepEqual(Object.keys(found[0]).sort(), ['id', 'name']);
  marina = found[0];
  assert.match(marina.name, /^Marina Crest/);
  const solo = db.prepare("SELECT o.name FROM organization o WHERE o.kind = 'AGENT' LIMIT 1").get();
  assert.equal((await c.get(`/api/public/agencies?q=${encodeURIComponent(solo.name.slice(0, 6))}`)).data.some((a) => a.name === solo.name), false);

  const ok = await c.post('/api/auth/check-profile', { full_name: 'Joe Joiner', phone: '0501112222', email: 'joe@example.com', agency_id: marina.id });
  assert.equal(ok.data.agency_name, marina.name);
  assert.equal((await c.post('/api/auth/check-profile', { full_name: 'Joe Joiner', phone: '0501112222', email: 'joe@example.com', agency_id: 99999 })).data.error, 'AGENCY_NOT_FOUND');
});

test('agent asks to join; the agency approves with role and daily limit; the agent lands in the agency', async () => {
  const a = client(srv.base);
  await a.login('fresh-joiner');
  await a.post('/api/me/profile', { full_name: 'Joe Joiner', phone: '0501112222' });
  const r = await a.post('/api/me/join-requests', { org_id: marina.id });
  assert.equal(r.data.status, 'PENDING');
  assert.equal((await a.post('/api/me/join-requests', { org_id: marina.id })).data.id, r.data.id, 'no duplicate request');
  let me = (await a.get('/api/me')).data;
  assert.equal(me.active_org, null);
  assert.equal(me.join_requests[0].status, 'PENDING');

  const d = client(srv.base);
  await d.login('director');
  assert.equal((await d.get('/api/me')).data.join_requests_waiting, 1);
  assert.ok((await d.get('/api/me/notifications')).data.some((n) => n.type === 'JOIN_REQUEST' && n.body.includes('Joe Joiner')));
  const list = (await d.get('/api/org/join-requests')).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].phone, '+971501112222');

  const agent = client(srv.base);
  await agent.login('agent1');
  assert.equal((await agent.get('/api/org/join-requests')).status, 403, 'agents cannot approve');

  assert.equal((await d.post(`/api/org/join-requests/${list[0].id}`, { approve: true, role: 'ORG_OWNER' })).data.error, 'INVALID_ROLE');
  const ok = await d.post(`/api/org/join-requests/${list[0].id}`, { approve: true, role: 'AGENT', daily_cap: 5 });
  assert.equal(ok.data.status, 'APPROVED');

  me = (await a.get('/api/me')).data;
  assert.equal(me.active_org.org_id, marina.id, 'the existing session opens the agency');
  assert.equal(me.active_org.role, 'AGENT');
  assert.equal(me.my_quota.cap, 5);
  assert.ok(me.entitlements.cold.active, 'works on the agency plan');
  assert.ok((await a.get('/api/me/notifications')).data.some((n) => n.type === 'JOIN_APPROVED'));
  assert.equal((await d.get('/api/me')).data.join_requests_waiting, 0);
});

test('declined and cancelled requests give no access', async () => {
  const b = client(srv.base);
  await b.login('fresh-joiner2');
  const r = await b.post('/api/me/join-requests', { org_id: marina.id });
  const d = client(srv.base);
  await d.login('director');
  assert.equal((await d.post(`/api/org/join-requests/${r.data.id}`, { approve: false })).data.status, 'DECLINED');
  const me = (await b.get('/api/me')).data;
  assert.equal(me.active_org, null);
  assert.equal(me.join_requests[0].status, 'DECLINED');
  assert.equal(me.memberships.length, 0);

  const again = await b.post('/api/me/join-requests', { org_id: marina.id });
  assert.equal(again.data.status, 'PENDING', 'can ask again');
  assert.equal((await b.del(`/api/me/join-requests/${again.data.id}`)).status, 200);
  assert.equal((await d.get('/api/org/join-requests')).data.length, 0);
});

test('roster: agents the agency added are listed with a short name and email hint; picking one needs that email', async () => {
  const d = client(srv.base);
  await d.login('director');
  await d.post('/api/org/invitations', { full_name: 'Rami Khoury Saad', phone: '050 121 2121', email: 'rami.k@roster.example', role: 'AGENT', daily_cap: 6 });
  const c = client(srv.base);
  const roster = (await c.get(`/api/public/agencies/${marina.id}/roster`)).data;
  const rami = roster.find((r) => r.name === 'Rami S.');
  assert.ok(rami, JSON.stringify(roster));
  assert.equal(rami.email_hint, 'r•••@roster.example');
  assert.ok(!JSON.stringify(roster).includes('121'), 'no mobile numbers');
  assert.ok(!JSON.stringify(roster).includes('rami.k@'), 'no full emails');

  const wrong = await c.post('/api/auth/check-profile', { full_name: 'Rami Saad', phone: '0501212121', email: 'other@roster.example', agency_id: marina.id, invitation_id: rami.id });
  assert.equal(wrong.data.error, 'INVITATION_EMAIL_MISMATCH');
  assert.match(wrong.data.message, /r•••@roster\.example/);
  const ok = await c.post('/api/auth/check-profile', { full_name: 'Rami Saad', phone: '0501212121', email: 'Rami.K@roster.example', agency_id: marina.id, invitation_id: rami.id });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.invitation_id, rami.id);
  assert.equal((await c.get('/api/public/agencies/99999/roster')).data.error, 'AGENCY_NOT_FOUND');
});
