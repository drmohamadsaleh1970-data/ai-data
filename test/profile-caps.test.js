import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, key, eligibleIds } from './helpers.js';

let srv, db;
before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
});
after(async () => { await srv.close(); });

test('sign-up details are checked before Google: name, mobile (normalised) and email', async () => {
  const c = client(srv.base);
  const ok = await c.post('/api/auth/check-profile', { full_name: '  Sara   Al Mansouri ', phone: '050 123 4567', email: 'Sara@Example.com' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(ok.data, { full_name: 'Sara Al Mansouri', phone: '+971501234567', email: 'sara@example.com' });
  assert.equal((await c.post('/api/auth/check-profile', { full_name: 'Sara', phone: '+44 7700 900123', email: 's@example.com' })).data.phone, '+447700900123');
  assert.equal((await c.post('/api/auth/check-profile', { full_name: 'Sara', phone: '12', email: 's@example.com' })).data.error, 'INVALID_PHONE');
  assert.equal((await c.post('/api/auth/check-profile', { full_name: 'S', phone: '0501234567', email: 's@example.com' })).data.error, 'INVALID_NAME');
  assert.equal((await c.post('/api/auth/check-profile', { full_name: 'Sara', phone: '0501234567', email: 'not-an-email' })).data.error, 'INVALID_EMAIL');
});

test('an account without a mobile number must complete its profile; the confirmed name is kept', async () => {
  db.prepare("UPDATE platform_user SET phone = NULL, profile_completed_at = NULL WHERE google_sub = 'fixture|newuser'").run();
  const c = client(srv.base);
  await c.login('newuser');
  assert.equal((await c.get('/api/me')).data.profile_complete, false);
  assert.equal((await c.post('/api/me/profile', { full_name: 'Nadia Visitor', phone: 'abc' })).data.error, 'INVALID_PHONE');
  const saved = await c.post('/api/me/profile', { full_name: 'Nadia Visitor', phone: '+971 55 765 4321' });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const me = (await c.get('/api/me')).data;
  assert.equal(me.profile_complete, true);
  assert.equal(me.user.phone, '+971557654321');
  assert.equal(me.user.name, 'Nadia Visitor');
  // A later Google sign-in must not replace the confirmed name with the Google display name.
  const { upsertGoogleUser } = await import('../server/auth.js');
  upsertGoogleUser({ sub: 'fixture|newuser', email: 'new.user@gmail.example', name: 'Google Display Name' });
  assert.equal((await c.get('/api/me')).data.user.name, 'Nadia Visitor');
});

test('director sets a personal daily limit: the member is stopped at it, the shared pool still applies', async () => {
  const d = client(srv.base);
  await d.login('director');
  const team = (await d.get('/api/org/members')).data;
  const agent = team.members.find((m) => m.email === 'agent1@marinacrest.example');
  assert.ok(agent && team.account_limit === 999);
  assert.equal((await d.patch(`/api/org/members/${agent.user_id}`, { daily_cap: -1 })).data.error, 'INVALID_CAP');
  assert.equal((await d.patch(`/api/org/members/${agent.user_id}`, { daily_cap: 3 })).status, 200);

  const a = client(srv.base);
  await a.login('agent1');
  assert.deepEqual((await a.get('/api/me')).data.my_quota, { cap: 3, used: 0, remaining: 3 });
  // Agents cannot change limits.
  assert.equal((await a.patch(`/api/org/members/${agent.user_id}`, { daily_cap: 500 })).status, 403);

  const ids = await eligibleIds(a, { city: ['Dubai'] }, 40);
  const fresh = [];
  for (const id of ids) {
    if (!db.prepare('SELECT 1 FROM record_acquisition_grant g JOIN membership m ON m.org_id = g.org_id WHERE g.investor_id = ? AND m.user_id = ?').get(id, agent.user_id)) fresh.push(id);
    if (fresh.length === 5) break;
  }
  assert.equal(fresh.length, 5);
  const est = await a.post('/api/cold/transfers/estimate', { selection: { mode: 'ids', ids: fresh } });
  assert.equal(est.data.quota.remaining, 3);
  assert.equal(est.data.quota.my_cap, 3);
  assert.equal(est.data.deliverable_now, 3);

  const blocked = await a.post('/api/cold/transfers', { selection: { mode: 'ids', ids: fresh } }, { 'idempotency-key': key() });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, 'USER_DAILY_CAP');
  const partial = await a.post('/api/cold/transfers', { selection: { mode: 'ids', ids: fresh }, allow_partial: true }, { 'idempotency-key': key() });
  assert.equal(partial.status, 200, JSON.stringify(partial.data));
  assert.equal(partial.data.charged, 3);
  assert.equal(partial.data.items.filter((i) => i.reason === 'USER_DAILY_CAP_REACHED').length, 2);
  assert.deepEqual((await a.get('/api/me')).data.my_quota, { cap: 3, used: 3, remaining: 0 });

  // Removing the limit lets the member use the shared allowance again.
  assert.equal((await d.patch(`/api/org/members/${agent.user_id}`, { daily_cap: null })).status, 200);
  const rest = fresh.filter((id) => !partial.data.items.some((i) => i.investor_id === id && i.outcome === 'TRANSFERRED'));
  const after = await a.post('/api/cold/transfers', { selection: { mode: 'ids', ids: rest } }, { 'idempotency-key': key() });
  assert.equal(after.status, 200, JSON.stringify(after.data));
  assert.equal(after.data.charged, rest.length);
  const row = (await d.get('/api/org/members')).data.members.find((m) => m.user_id === agent.user_id);
  assert.equal(row.used_today, 5);
  assert.equal(row.daily_cap, null);
});

test('invitation carries name, mobile and daily limit; accepting it applies them', async () => {
  db.prepare("UPDATE platform_user SET phone = NULL, profile_completed_at = NULL WHERE google_sub = 'fixture|pending'").run();
  const d = client(srv.base);
  await d.login('director');
  assert.equal((await d.post('/api/org/invitations', { full_name: 'Paula Pending', phone: 'bad', email: 'pending@palmgate.example', role: 'AGENT' })).data.error, 'INVALID_PHONE');
  const inv = await d.post('/api/org/invitations', { full_name: 'Paula Pending', phone: '052 222 3333', email: 'Pending@PalmGate.example', role: 'AGENT', daily_cap: 7 });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  const pending = (await d.get('/api/org/members')).data.invitations.find((i) => i.email === 'pending@palmgate.example');
  assert.equal(pending.phone, '+971522223333');
  assert.equal(pending.daily_cap, 7);

  const p = client(srv.base);
  await p.login('pending');
  const me = (await p.get('/api/me')).data;
  const org = me.memberships.find((m) => m.name.startsWith('Marina Crest'));
  assert.ok(org, 'joined the inviting agency');
  await p.post('/api/me/active-org', { org_id: org.org_id });
  const me2 = (await p.get('/api/me')).data;
  assert.equal(me2.user.phone, '+971522223333', 'mobile from the invitation fills an empty profile');
  assert.equal(me2.profile_complete, false, 'the person still confirms their own details once');
  assert.equal(me2.my_quota.cap, 7);
});
