import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, key, eligibleIds } from './helpers.js';

let srv, billing, db, util;
before(async () => {
  srv = await startTestServer();
  billing = await import('../server/billing.js');
  db = (await import('../server/db.js')).getDb();
  util = await import('../server/util.js');
});
after(async () => { util.setClockOffset(0); await srv.close(); });

test('cash payment stays pending until finance verifies receipt; magic link activates only for the right Google identity, once', async () => {
  const p = client(srv.base);
  await p.login('pending');
  let ent = (await p.get('/api/me/entitlements')).data;
  assert.equal(ent.cold.active, false);
  assert.equal((await p.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [1] } }, { 'idempotency-key': key() })).status, 402);

  const f = client(srv.base);
  await f.login('finance');
  const dash = await f.get('/api/owner/dashboard');
  const reqId = dash.data.pending_cash[0].id;
  assert.equal((await f.post(`/api/owner/cash/${reqId}/verify`, { amount_usd: 999, paid_on: '2026-10-30', channel: 'CASH_OFFICE', receipt_no: 'R-1' })).status, 401, 'MFA required');
  await f.mfa();
  const low = await f.post(`/api/owner/cash/${reqId}/verify`, { amount_usd: 99, paid_on: '2026-10-30', channel: 'CASH_OFFICE', receipt_no: 'R-1' });
  assert.equal(low.data.error, 'AMOUNT_BELOW_PLAN_PRICE');
  const missing = await f.post(`/api/owner/cash/${reqId}/verify`, { amount_usd: 999 });
  assert.equal(missing.data.error, 'RECEIPT_DETAILS_REQUIRED');
  const ok = await f.post(`/api/owner/cash/${reqId}/verify`, { amount_usd: 999, paid_on: '2026-10-30', channel: 'CASH_OFFICE', receipt_no: 'R-1001' });
  assert.equal(ok.status, 200);
  // No email service yet: finance gets the single-use link to send by WhatsApp or email.
  assert.equal(ok.data.delivered_to, 'pending@palmgate.example');
  assert.ok(ok.data.activation_link.startsWith(`${srv.base}/#/activate/`), ok.data.activation_link);
  assert.equal((await f.post(`/api/owner/cash/${reqId}/verify`, { amount_usd: 999, paid_on: '2026-10-30', channel: 'CASH_OFFICE', receipt_no: 'R-1001' })).data.error, 'ALREADY_PROCESSED');

  // Verified but not yet activated → still no entitlement.
  ent = (await p.get('/api/me/entitlements')).data;
  assert.equal(ent.cold.active, false);
  const token = ok.data.activation_link.match(/#\/activate\/([\w-]+)/)[1];
  assert.ok(!JSON.stringify(dash.data).includes(token), 'token never exposed in dashboards');

  const intruder = client(srv.base);
  await intruder.login('solo');
  assert.equal((await intruder.post('/api/billing/activate', { token })).data.error, 'LINK_WRONG_ACCOUNT');
  const act = await p.post('/api/billing/activate', { token });
  assert.equal(act.status, 200);
  ent = (await p.get('/api/me/entitlements')).data;
  assert.equal(ent.cold.active, true);
  assert.equal(ent.cold.quota.plan_limit, 999);
  assert.equal((await p.post('/api/billing/activate', { token })).data.error, 'LINK_ALREADY_USED');
});

test('magic links expire', async () => {
  const s = client(srv.base);
  await s.login('solo');
  const req = await s.post('/api/billing/cash', { plan: 'AGENT_MONTHLY' });
  const f = client(srv.base);
  await f.login('finance');
  await f.mfa();
  const verified = await f.post(`/api/owner/cash/${req.data.id}/verify`, { amount_usd: 99, paid_on: '2026-10-30', channel: 'BANK', receipt_no: 'R-2' });
  const token = verified.data.activation_link.match(/#\/activate\/([\w-]+)/)[1];
  util.setClockOffset(49 * 3_600_000);
  await s.login('solo'); // the 12h session also expired; sign in again
  assert.equal((await s.post('/api/billing/activate', { token })).data.error, 'LINK_EXPIRED');
  util.setClockOffset(0);
});

test('reissuing an activation link returns a fresh link and revokes the old one', async () => {
  const s = client(srv.base);
  await s.login('solo');
  const req = await s.post('/api/billing/cash', { plan: 'AGENT_MONTHLY' });
  const f = client(srv.base);
  await f.login('finance');
  await f.mfa();
  const first = await f.post(`/api/owner/cash/${req.data.id}/verify`, { amount_usd: 99, paid_on: '2026-10-30', channel: 'BANK', receipt_no: 'R-3' });
  const again = await f.post(`/api/owner/subscriptions/${first.data.subscription_id}/reissue-link`);
  assert.equal(again.data.delivered_to, 'solo@example.com');
  assert.notEqual(again.data.activation_link, first.data.activation_link);
  const token = (r) => r.data.activation_link.match(/#\/activate\/([\w-]+)/)[1];
  assert.equal((await s.post('/api/billing/activate', { token: token(first) })).data.error, 'LINK_REVOKED');
  assert.equal((await s.post('/api/billing/activate', { token: token(again) })).status, 200);
});

function paypalSub(orgId, plan = 'AGENCY_MONTHLY') {
  const ts = new Date().toISOString();
  return Number(db.prepare("INSERT INTO subscription (org_id, plan_code, status, provider, price_snapshot_cents, created_at, updated_at) VALUES (?,?,'PENDING_PAYMENT','PAYPAL',99900,?,?)").run(orgId, plan, ts, ts).lastInsertRowid);
}
const hook = (c, ev) => c.post('/api/webhooks/paypal', ev, { 'x-aihome-csrf': '' });

test('PayPal: only verified webhooks activate; duplicates, stale ordering, plan mismatch and cross-tenant binding are ignored', async () => {
  billing.setPaypalPlanLookup((code) => `P-TEST-${code}`);
  const c = client(srv.base);
  // Fresh agency org with a pending PayPal checkout.
  await c.login('newuser');
  const org = await c.post('/api/organizations', { name: 'Webhook Realty (TEST)', kind: 'AGENCY', terms: true });
  const subId = paypalSub(org.data.id);
  const activated = { id: 'WH-1', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', create_time: new Date().toISOString(),
    resource: { id: 'I-PP-1', custom_id: `aih-sub-${subId}`, plan_id: 'P-TEST-AGENCY_MONTHLY', billing_info: { next_billing_time: new Date(Date.now() + 30 * 86400000).toISOString() } } };

  billing.setPaypalVerifier(async () => false);
  assert.equal((await hook(c, activated)).data.error, 'WEBHOOK_SIGNATURE_INVALID');
  assert.equal((await c.get('/api/me/entitlements')).data.cold.active, false, 'client-side success alone never activates');

  billing.setPaypalVerifier(async () => true);
  assert.equal((await hook(c, { ...activated, id: 'WH-0', resource: { ...activated.resource, plan_id: 'P-TEST-AGENT_MONTHLY' } })).data.outcome, 'IGNORED_PLAN_MISMATCH');
  assert.equal((await hook(c, activated)).data.outcome, 'ACTIVATED');
  assert.equal((await hook(c, activated)).data.duplicate, true);
  let ent = (await c.get('/api/me/entitlements')).data;
  assert.equal(ent.cold.active, true);
  assert.equal(ent.cold.quota.plan_limit, 999);

  // Another tenant's event cannot rebind this subscription via custom_id.
  const hijack = { id: 'WH-X', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', create_time: new Date().toISOString(), resource: { id: 'I-OTHER', custom_id: `aih-sub-${subId}`, plan_id: 'P-TEST-AGENCY_MONTHLY' } };
  assert.equal((await hook(c, hijack)).data.outcome, 'IGNORED_UNKNOWN_SUBSCRIPTION');

  // Renewal payment recorded once.
  const sale = { id: 'WH-2', event_type: 'PAYMENT.SALE.COMPLETED', create_time: new Date().toISOString(), resource: { id: 'SALE-1', billing_agreement_id: 'I-PP-1', amount: { total: '999.00', currency: 'USD' } } };
  assert.equal((await hook(c, sale)).data.outcome, 'PAYMENT_RECORDED');
  assert.equal((await hook(c, { ...sale, id: 'WH-2b' })).data.outcome, 'DUPLICATE_PAYMENT');

  // Failed renewal pauses new paid transfers; CRM data stays.
  const ids = await eligibleIds(c, {}, 3);
  const t = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids } }, { 'idempotency-key': key() });
  assert.equal(t.data.charged, 3);
  const failed = { id: 'WH-3', event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', create_time: new Date(Date.now() + 1000).toISOString(), resource: { id: 'I-PP-1', plan_id: 'P-TEST-AGENCY_MONTHLY' } };
  assert.equal((await hook(c, failed)).data.outcome, 'PAST_DUE');
  const blocked = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids: await eligibleIds(c, {}, 1) } }, { 'idempotency-key': key() });
  assert.equal(blocked.status, 402);
  assert.equal((await c.get('/api/crm/leads')).data.length, 3, 'existing CRM records preserved');

  // An older event arriving late does not resurrect the subscription.
  const late = { ...activated, id: 'WH-OLD', create_time: new Date(Date.now() - 3600_000).toISOString() };
  assert.equal((await hook(c, late)).data.outcome, 'IGNORED_STALE_ORDERING');
  assert.equal((await c.get('/api/me/entitlements')).data.cold.active, false);

  // Reactivation restores access; the same 3 records are not charged again.
  const re = { ...activated, id: 'WH-4', event_type: 'BILLING.SUBSCRIPTION.RE-ACTIVATED', create_time: new Date(Date.now() + 2000).toISOString() };
  assert.equal((await hook(c, re)).data.outcome, 'ACTIVATED');
  const again = await c.post('/api/cold/transfers', { selection: { mode: 'ids', ids } }, { 'idempotency-key': key() });
  assert.equal(again.data.charged, 0);
  assert.equal(again.data.quota.used, 3);
});

test('PayPal checkout reports NOT_CONNECTED when credentials are absent (no fake button)', async () => {
  const c = client(srv.base);
  await c.login('director');
  const r = await c.post('/api/billing/paypal', { plan: 'AGENCY_MONTHLY' });
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'PAYPAL_NOT_CONNECTED');
  assert.equal((await c.post('/api/billing/cash', { plan: 'PLATFORM_MASTER_OWNER' })).data.error, 'PLAN_NOT_PURCHASABLE');
});
