import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, key, eligibleIds } from './helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { (await import('../server/util.js')).setClockOffset(0); await srv.close(); });

test('search/filter/preview never consumes quota and returns masked PII only', async () => {
  const c = client(srv.base);
  await c.login('agent1');
  const before = (await c.get('/api/me/entitlements')).data.cold.quota;
  const { data } = await c.post('/api/cold/search', { filter: { city: ['Dubai'], area: ['Dubai Marina'], client_role: 'BUYER', property_type: ['Apartment', 'Villa'], year_from: 2016, price_max: 50_000_000 } });
  assert.ok(data.counts.total > 0);
  for (const r of data.results) {
    assert.ok(!r.name || r.name.includes('•'), 'name must be masked');
    assert.ok(!r.email || r.email.includes('•'), 'email must be masked');
    assert.ok(!r.phone || r.phone.includes('•'), 'phone must be masked');
    if (r.rights_status !== 'APPROVED') assert.equal(r.name, null, 'restricted rows carry no PII');
  }
  const est = await c.post('/api/cold/transfers/estimate', { selection: { mode: 'filter', filter: { area: ['Dubai Marina'] } } });
  assert.equal(est.status, 200);
  assert.ok(est.data.new_chargeable > 0 && est.data.blocked > 0);
  const after = (await c.get('/api/me/entitlements')).data.cold.quota;
  assert.equal(after.committed_used, before.committed_used);
  assert.equal(after.plan_limit, 999);
});

test('transfer 25 eligible records: charged once, CRM leads + tasks + notifications created', async () => {
  const c = client(srv.base);
  await c.login('director');
  const ids = await eligibleIds(c, { city: ['Dubai'] }, 25);
  assert.equal(ids.length, 25);
  const k = key();
  const r = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids }, assign_to: 'ROUND_ROBIN', campaign_tag: 'marina-q4' }, { 'idempotency-key': k });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.charged, 25);
  assert.equal(r.data.quota.used, 25);
  assert.ok(r.data.items.every((i) => i.outcome === 'TRANSFERRED' && i.crm_link));

  const lead = await c.get(r.data.items[0].crm_link.replace('#/crm/lead/', '/api/crm/leads/'));
  assert.equal(lead.data.source_type, 'COLD');
  assert.equal(lead.data.source_detail, 'COLD_AI_HOME_HISTORY');
  assert.match(lead.data.provenance_note, /NOT verified as a new\/current inquiry/);
  assert.ok(lead.data.interest.historical_transactions.length >= 1);
  assert.equal(lead.data.tasks.length, 1);
  assert.ok(!lead.data.email || !lead.data.email.includes('•'), 'after lawful transfer, CRM shows real contact fields');

  // Same idempotency key → replay, nothing charged.
  const replay = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids } }, { 'idempotency-key': k });
  assert.equal(replay.data.idempotent_replay, true);
  assert.equal(replay.data.charged, 0);
  // New key, same records → ALREADY_ACQUIRED, no charge, no duplicate contacts.
  const again = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [...ids, ids[0]] } }, { 'idempotency-key': key() });
  assert.equal(again.data.charged, 0);
  assert.equal(again.data.already_acquired, 25);
  assert.equal(again.data.quota.used, 25);
  const leads = await c.get('/api/crm/leads?source=COLD');
  assert.equal(leads.data.length, 25);

  // Assigned agent got an in-app notification.
  const a = client(srv.base);
  await a.login('agent1');
  const notes = await a.get('/api/me/notifications');
  assert.ok(notes.data.some((n) => n.type === 'COLD_LEAD_ASSIGNED'));
});

test('restricted, unknown and over-quota records are rejected without charge', async () => {
  const c = client(srv.base);
  await c.login('solo');
  const { data } = await c.post('/api/cold/search', { filter: {}, limit: 50 });
  const restricted = data.results.find((r) => r.rights_status !== 'APPROVED');
  assert.ok(restricted);
  const r = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [restricted.id, 99999999] } }, { 'idempotency-key': key() });
  assert.equal(r.data.charged, 0);
  assert.deepEqual(r.data.items.map((i) => i.reason).sort(), ['NOT_FOUND', 'RIGHTS_PENDING_REVIEW']);

  // AGENT_MONTHLY: 99/day. 120 new → refused unless partial is confirmed.
  const ids = await eligibleIds(c, {}, 120);
  const refused = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids } }, { 'idempotency-key': key() });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.error, 'INSUFFICIENT_QUOTA');
  assert.equal(refused.data.remaining, 99);
  const partial = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids }, allow_partial: true }, { 'idempotency-key': key() });
  assert.equal(partial.data.charged, 99);
  assert.equal(partial.data.items.filter((i) => i.reason === 'DAILY_QUOTA_EXHAUSTED').length, 21);
  assert.equal(partial.data.quota.remaining, 0);
});

test('adding unlimited members never changes the shared daily quota', async () => {
  const c = client(srv.base);
  await c.login('director');
  for (let i = 0; i < 1000; i++) {
    const r = await c.post('/api/org/invitations', { email: `agent${i}@bulk.example`, role: 'AGENT' });
    assert.equal(r.status, 200);
  }
  const ent = await c.get('/api/me/entitlements');
  assert.equal(ent.data.cold.quota.plan_limit, 999);
  assert.equal((await c.get('/api/org/members')).data.invitations.length, 1000);
});

test('quota resets at 00:00 Asia/Dubai, not server UTC midnight', async () => {
  const util = await import('../server/util.js');
  const c = client(srv.base);
  await c.login('solo');
  const q1 = (await c.get('/api/me/entitlements')).data.cold.quota;
  assert.equal(q1.remaining, 0);
  const resetAt = new Date(q1.resets_at);
  // The reset instant is 20:00 UTC (= 00:00 Dubai, UTC+4).
  assert.equal(resetAt.getUTCHours(), 20);
  util.setClockOffset(resetAt.getTime() - Date.now() - 1000);
  assert.equal((await c.get('/api/me/entitlements')).data.cold.quota.remaining, 0, 'one second before Dubai midnight');
  util.setClockOffset(resetAt.getTime() - Date.now() + 1000);
  const q2 = (await c.get('/api/me/entitlements')).data.cold.quota;
  assert.equal(q2.remaining, 99);
  assert.notEqual(q2.local_day, q1.local_day);
  util.setClockOffset(0);
});

test('legal gate: transfer disabled flag blocks person-level transfer server-side', async () => {
  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  assert.equal((await o.post('/api/owner/flags', { key: 'COLD_SUBSCRIBER_TRANSFER', enabled: false })).status, 200);
  const c = client(srv.base);
  await c.login('agent2');
  const { data } = await c.post('/api/cold/search', { filter: {} });
  assert.equal(data.transfer_enabled, false);
  const r = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [data.results[0].id] } }, { 'idempotency-key': key() });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'TRANSFER_DISABLED_PENDING_LEGAL_APPROVAL');
  await o.post('/api/owner/flags', { key: 'COLD_SUBSCRIBER_TRANSFER', enabled: true });
});
