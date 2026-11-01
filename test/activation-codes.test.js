import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

let srv, db;
before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
});
after(async () => { await srv.close(); });

const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

async function payAndConfirm(receiptNo) {
  const p = client(srv.base);
  await p.login('pending');
  const cash = await p.post('/api/billing/cash', { plan: 'AGENCY_MONTHLY', note: 'bank transfer today' });
  assert.equal(cash.status, 200, JSON.stringify(cash.data));
  const f = client(srv.base);
  await f.login('finance');
  await f.mfa();
  const ok = await f.post(`/api/owner/cash/${cash.data.id}/verify`, { amount_aed: 999, paid_on: '2026-10-31', channel: 'BANK_TRANSFER', receipt_no: receiptNo });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  return { p, f, cash: cash.data, ok: ok.data };
}

test('a new payment request alerts owners and finance and shows in Payment approvals', async () => {
  const p = client(srv.base);
  await p.login('pending');
  const cash = (await p.post('/api/billing/cash', { plan: 'AGENCY_MONTHLY' })).data;
  for (const persona of ['owner', 'finance']) {
    const c = client(srv.base);
    await c.login(persona);
    const notes = (await c.get('/api/me/notifications')).data;
    const n = notes.find((x) => x.type === 'PAYMENT_TO_CONFIRM' && x.body.includes(cash.reference));
    assert.ok(n, `${persona} notified`);
    assert.equal(n.link, '#/owner/approvals');
    assert.ok((await c.get('/api/me')).data.approvals_waiting.to_confirm >= 1);
    const a = (await c.get('/api/owner/approvals')).data;
    const row = a.pending_cash.find((x) => x.reference === cash.reference);
    assert.ok(row && row.requested_by_phone && row.requested_by_name, 'customer name and mobile shown to the approver');
  }
  // Customers cannot see approvals.
  assert.equal((await p.get('/api/owner/approvals')).status, 403);
  assert.equal((await p.get('/api/me')).data.approvals_waiting, null);
});

test('confirming a payment sends the customer an activation code automatically; it works once, only for them', async () => {
  const { p, ok } = await payAndConfirm('BT-2001');
  assert.match(ok.activation_code, CODE);
  assert.equal(ok.delivered_to, 'pending@palmgate.example');

  // Delivered without anyone forwarding it: Billing page, /me flag, notification, email queue.
  const me = (await p.get('/api/me')).data;
  assert.equal(me.activation_pending, true);
  assert.equal((await p.get('/api/billing')).data.activation.code, ok.activation_code);
  const note = (await p.get('/api/me/notifications')).data.find((n) => n.type === 'ACTIVATION_CODE');
  assert.ok(note.body.includes(ok.activation_code));
  assert.equal(note.link, '#/billing');
  const mail = db.prepare("SELECT * FROM email_outbox WHERE to_email = 'pending@palmgate.example' ORDER BY id DESC LIMIT 1").get();
  assert.ok(mail.subject.includes(ok.activation_code) && mail.body.includes(ok.activation_code));
  assert.equal(mail.status, 'QUEUED', 'no email service in tests: kept in the outbox');

  const intruder = client(srv.base);
  await intruder.login('solo');
  assert.equal((await intruder.post('/api/billing/activate', { code: ok.activation_code })).data.error, 'LINK_WRONG_ACCOUNT');
  assert.equal((await p.post('/api/billing/activate', { code: 'ABC' })).data.error, 'CODE_INVALID');
  assert.equal((await p.post('/api/billing/activate', { code: 'ZZZZ-ZZZZ' })).data.error, 'LINK_INVALID');

  // Case and the dash do not matter.
  const act = await p.post('/api/billing/activate', { code: ok.activation_code.toLowerCase().replace('-', ' ') });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  assert.equal((await p.get('/api/me/entitlements')).data.cold.active, true);
  assert.equal((await p.get('/api/me')).data.activation_pending, false);
  assert.equal((await p.get('/api/billing')).data.activation, null);
  assert.equal((await p.post('/api/billing/activate', { code: ok.activation_code })).data.error, 'LINK_ALREADY_USED');
});

test('sending a new code replaces the old one', async () => {
  const { p, f, ok } = await payAndConfirm('BT-2002');
  const waiting = (await f.get('/api/owner/approvals')).data.awaiting_activation;
  const sub = waiting.find((s) => s.customer_email === 'pending@palmgate.example');
  assert.ok(sub && sub.code_expires_at);
  const again = await f.post(`/api/owner/subscriptions/${sub.id}/reissue-link`);
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.match(again.data.activation_code, CODE);
  assert.notEqual(again.data.activation_code, ok.activation_code);
  assert.equal((await p.get('/api/billing')).data.activation.code, again.data.activation_code);
  assert.equal((await p.post('/api/billing/activate', { code: ok.activation_code })).data.error, 'LINK_REVOKED');
  assert.equal((await p.post('/api/billing/activate', { code: again.data.activation_code })).status, 200);
});
