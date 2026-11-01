import { getDb, tx } from './db.js';
import { config, paypalConfigured } from './config.js';
import { HttpError, iso, now, randomToken, sha256, audit, notify } from './util.js';
import { queueEmail } from './mail.js';
import crypto from 'node:crypto';

export const PUBLIC_PLANS = ['AGENCY_MONTHLY', 'AGENT_MONTHLY'];

// Calendar billing month: Jan 31 + 1 month clamps to the last day of February.
export function addMonth(d) {
  const x = new Date(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + 1);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x;
}

function plan(code) {
  if (!PUBLIC_PLANS.includes(code)) throw new HttpError(400, 'PLAN_NOT_PURCHASABLE');
  return getDb().prepare('SELECT * FROM subscription_plan WHERE code = ?').get(code);
}

// A new plan becomes effective at a defined instant; the previous one is closed at that
// same instant so quota re-evaluation is unambiguous.
function supersedeOthers(conn, orgId, keepId, at) {
  conn.prepare(`UPDATE subscription SET status = 'CANCELLED', current_period_end = ?, updated_at = ?
    WHERE org_id = ? AND id != ? AND status IN ('ACTIVE','PAST_DUE')`).run(at, iso(), orgId, keepId);
}

// --- PayPal --------------------------------------------------------------------------
const paypalBase = () => (config.paypal.env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

async function paypalToken() {
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new HttpError(502, 'PAYPAL_AUTH_FAILED');
  return (await res.json()).access_token;
}

export async function startPaypalCheckout({ orgId, planCode, user }) {
  const p = plan(planCode);
  if (!paypalConfigured() || !config.paypal.planIds[planCode]) {
    throw new HttpError(503, 'PAYPAL_NOT_CONNECTED', 'PayPal is not connected for this deployment. Use Cash / Offline or ask the platform owner to configure PayPal.');
  }
  const ts = iso();
  const subId = Number(getDb().prepare(`INSERT INTO subscription (org_id, plan_code, status, provider, price_snapshot_cents, created_at, updated_at)
    VALUES (?,?,'PENDING_PAYMENT','PAYPAL',?,?,?)`).run(orgId, planCode, p.price_usd_cents, ts, ts).lastInsertRowid);
  const token = await paypalToken();
  const res = await fetch(`${paypalBase()}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `aih-sub-${subId}` },
    body: JSON.stringify({
      plan_id: config.paypal.planIds[planCode],
      custom_id: `aih-sub-${subId}`,
      subscriber: { email_address: user.email },
      application_context: { brand_name: 'AI-DATA', user_action: 'SUBSCRIBE_NOW', return_url: `${config.baseUrl}/#/billing?paypal=return`, cancel_url: `${config.baseUrl}/#/billing?paypal=cancel` },
    }),
  });
  if (!res.ok) throw new HttpError(502, 'PAYPAL_CREATE_FAILED');
  const body = await res.json();
  getDb().prepare('UPDATE subscription SET external_id = ? WHERE id = ?').run(body.id, subId);
  audit({ actor: user.id, org: orgId, action: 'PAYPAL_CHECKOUT_STARTED', target: `subscription:${subId}` });
  // The return redirect grants nothing; only a verified webhook activates the plan.
  return { subscription_id: subId, approve_url: body.links?.find((l) => l.rel === 'approve')?.href };
}

// Official signature verification through PayPal's verify-webhook-signature API.
export async function paypalVerifySignature(headers, event) {
  if (!paypalConfigured()) return false;
  const token = await paypalToken();
  const res = await fetch(`${paypalBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'], transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'], transmission_time: headers['paypal-transmission-time'],
      webhook_id: config.paypal.webhookId, webhook_event: event,
    }),
  });
  return res.ok && (await res.json()).verification_status === 'SUCCESS';
}

let verifier = paypalVerifySignature;
export const setPaypalVerifier = (fn) => { verifier = fn; };
let planIdLookup = (code) => config.paypal.planIds[code];
export const setPaypalPlanLookup = (fn) => { planIdLookup = fn; };

export async function handlePaypalWebhook(headers, event) {
  const verified = await verifier(headers, event);
  const db = getDb();
  if (!verified) {
    audit({ action: 'PAYPAL_WEBHOOK_REJECTED', target: event?.id, meta: { reason: 'SIGNATURE' } });
    throw new HttpError(400, 'WEBHOOK_SIGNATURE_INVALID');
  }
  return tx((conn) => {
    const seen = conn.prepare("SELECT outcome FROM billing_provider_event WHERE provider='PAYPAL' AND event_id = ?").get(event.id);
    if (seen) return { duplicate: true, outcome: seen.outcome };
    const outcome = applyPaypalEvent(conn, event);
    conn.prepare("INSERT INTO billing_provider_event (provider, event_id, event_type, event_time, verified, outcome, received_at) VALUES ('PAYPAL',?,?,?,1,?,?)")
      .run(event.id, event.event_type, event.create_time ?? null, outcome, iso());
    return { duplicate: false, outcome };
  }, db);
}

function applyPaypalEvent(conn, event) {
  const r = event.resource || {};
  const isSale = event.event_type.startsWith('PAYMENT.SALE');
  const externalId = isSale ? r.billing_agreement_id : r.id;
  let sub = externalId ? conn.prepare("SELECT * FROM subscription WHERE provider='PAYPAL' AND external_id = ?").get(externalId) : null;
  if (!sub && r.custom_id?.startsWith('aih-sub-')) {
    const candidate = conn.prepare("SELECT * FROM subscription WHERE id = ? AND provider='PAYPAL'").get(Number(r.custom_id.slice(8)));
    // custom_id alone cannot bind a different PayPal subscription to an existing row.
    if (candidate && (!candidate.external_id || candidate.external_id === externalId)) sub = candidate;
  }
  if (!sub) return 'IGNORED_UNKNOWN_SUBSCRIPTION';
  if (r.plan_id && r.plan_id !== planIdLookup(sub.plan_code)) return 'IGNORED_PLAN_MISMATCH';
  if (!sub.external_id) conn.prepare('UPDATE subscription SET external_id = ? WHERE id = ?').run(externalId, sub.id);

  const evTime = event.create_time || iso();
  const ts = iso();
  const statusEvent = !isSale;
  if (statusEvent && sub.last_provider_event_at && evTime < sub.last_provider_event_at) return 'IGNORED_STALE_ORDERING';
  const setStatus = (status, extra = {}) => {
    conn.prepare(`UPDATE subscription SET status = ?, current_period_start = COALESCE(?, current_period_start), current_period_end = COALESCE(?, current_period_end),
      effective_at = COALESCE(effective_at, ?), last_provider_event_at = ?, updated_at = ? WHERE id = ?`)
      .run(status, extra.start ?? null, extra.end ?? null, ts, statusEvent ? evTime : sub.last_provider_event_at, ts, sub.id);
  };

  switch (event.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
    case 'BILLING.SUBSCRIPTION.RE-ACTIVATED': {
      const start = sub.current_period_start || ts;
      const end = r.billing_info?.next_billing_time || sub.current_period_end || addMonth(new Date(start)).toISOString();
      setStatus('ACTIVE', { start, end });
      supersedeOthers(conn, sub.org_id, sub.id, ts);
      notifyOrgOwner(conn, sub.org_id, 'SUBSCRIPTION_ACTIVE', 'Your Cold Data subscription is active.');
      return 'ACTIVATED';
    }
    case 'PAYMENT.SALE.COMPLETED': {
      const dup = conn.prepare("SELECT 1 FROM payment WHERE provider='PAYPAL' AND external_id = ?").get(r.id);
      if (dup) return 'DUPLICATE_PAYMENT';
      const cents = Math.round(Number(r.amount?.total || 0) * 100);
      conn.prepare(`INSERT INTO payment (org_id, subscription_id, provider, amount_cents, currency, status, external_id, receipt_no, paid_at, created_at)
        VALUES (?,?, 'PAYPAL', ?, ?, 'COMPLETED', ?, ?, ?, ?)`).run(sub.org_id, sub.id, cents, r.amount?.currency || 'AED', r.id, r.id, evTime, ts);
      const base = sub.current_period_end && sub.current_period_end > evTime ? sub.current_period_end : evTime;
      const end = sub.status === 'ACTIVE' && sub.current_period_end && sub.current_period_end > evTime ? sub.current_period_end : addMonth(new Date(base)).toISOString();
      if (['PAST_DUE', 'ACTIVE', 'PENDING_PAYMENT'].includes(sub.status)) setStatus(sub.status === 'PENDING_PAYMENT' ? 'PENDING_PAYMENT' : 'ACTIVE', { end });
      return 'PAYMENT_RECORDED';
    }
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
      setStatus('PAST_DUE');
      notifyOrgOwner(conn, sub.org_id, 'PAYMENT_FAILED', 'PayPal renewal failed. New Cold transfers are paused until payment succeeds.');
      return 'PAST_DUE';
    case 'BILLING.SUBSCRIPTION.SUSPENDED':
      setStatus('SUSPENDED');
      return 'SUSPENDED';
    case 'BILLING.SUBSCRIPTION.CANCELLED':
      // Policy: cancellation stops renewal; access continues to the end of the paid period.
      setStatus('CANCELLED');
      return 'CANCELLED';
    case 'BILLING.SUBSCRIPTION.EXPIRED':
      setStatus('EXPIRED');
      return 'EXPIRED';
    case 'PAYMENT.SALE.REFUNDED':
    case 'PAYMENT.SALE.REVERSED':
      conn.prepare("UPDATE payment SET status = ? WHERE provider='PAYPAL' AND external_id = ?")
        .run(event.event_type.endsWith('REFUNDED') ? 'REFUNDED' : 'REVERSED', r.sale_id || r.id);
      setStatus('REFUNDED');
      return 'REFUNDED';
    default:
      return 'IGNORED_EVENT_TYPE';
  }
}

function notifyOrgOwner(conn, orgId, type, body) {
  const org = conn.prepare('SELECT owner_user_id FROM organization WHERE id = ?').get(orgId);
  if (org) conn.prepare('INSERT INTO notification (user_id, org_id, type, body, link, created_at) VALUES (?,?,?,?,?,?)').run(org.owner_user_id, orgId, type, body, '#/billing', iso());
}

// --- Cash / offline ------------------------------------------------------------------
const orgName = (conn, orgId) => conn.prepare('SELECT name FROM organization WHERE id = ?').get(orgId)?.name || `Organization ${orgId}`;

// Platform owners and finance admins see every payment waiting for confirmation.
function alertApprovers(conn, { type, body, baseUrl = config.baseUrl }) {
  const approvers = conn.prepare("SELECT id, email FROM platform_user WHERE platform_role IN ('PLATFORM_OWNER','PLATFORM_FINANCE_ADMIN')").all();
  for (const a of approvers) {
    conn.prepare('INSERT INTO notification (user_id, org_id, type, body, link, created_at) VALUES (?,?,?,?,?,?)').run(a.id, null, type, body, '#/owner/approvals', iso());
    if (!String(a.email).includes('@')) continue;
    queueEmail(conn, { userId: a.id, to: a.email, subject: 'AI-DATA: payment waiting for your confirmation', body: `${body}\n\nApprovals: ${baseUrl}/#/owner/approvals` });
  }
}

// Activation codes: 8 characters without look-alikes (no 0/O, 1/I/L), shown as XXXX-XXXX.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newActivationCode() {
  const bytes = crypto.randomBytes(8);
  const raw = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
export const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function requestCash({ orgId, planCode, user, note, baseUrl = config.baseUrl }) {
  const p = plan(planCode);
  const reference = 'AIH-' + randomToken(5).toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 7);
  const id = Number(getDb().prepare(`INSERT INTO cash_payment_request (org_id, plan_code, amount_cents, currency, reference, status, requested_by, customer_note, created_at)
    VALUES (?,?,?,'AED',?,'PENDING_PAYMENT',?,?,?)`).run(orgId, planCode, p.price_usd_cents, reference, user.id, note?.slice(0, 500) ?? null, iso()).lastInsertRowid);
  audit({ actor: user.id, org: orgId, action: 'CASH_REQUEST_CREATED', target: `cash:${id}` });
  alertApprovers(getDb(), {
    baseUrl,
    type: 'PAYMENT_TO_CONFIRM',
    body: `New payment to confirm: ${orgName(getDb(), orgId)} · ${p.name} · AED ${(p.price_usd_cents / 100).toFixed(0)} · ref ${reference}. Open Approvals once the money is received.`,
  });
  return getDb().prepare('SELECT * FROM cash_payment_request WHERE id = ?').get(id);
}

export function verifyCash({ requestId, approver, amountCents, currency = 'AED', paidOn, channel, receiptNo, baseUrl = config.baseUrl }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new HttpError(400, 'AMOUNT_REQUIRED');
  if (!paidOn || !channel || !receiptNo) throw new HttpError(400, 'RECEIPT_DETAILS_REQUIRED', 'Amount, paid date, channel and receipt number are required.');
  if (currency !== 'AED') throw new HttpError(400, 'CURRENCY_NOT_CONFIGURED', 'Only AED settlement is configured. Add a verified FX policy before accepting other currencies.');
  return tx((conn) => {
    const req = conn.prepare('SELECT * FROM cash_payment_request WHERE id = ?').get(Number(requestId));
    if (!req) throw new HttpError(404, 'NOT_FOUND');
    if (req.status !== 'PENDING_PAYMENT') throw new HttpError(409, 'ALREADY_PROCESSED');
    if (amountCents < req.amount_cents) throw new HttpError(400, 'AMOUNT_BELOW_PLAN_PRICE');
    const ts = iso();
    conn.prepare('INSERT INTO cash_verification (request_id, amount_cents, currency, paid_on, channel, receipt_no, approver_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(req.id, amountCents, currency, paidOn, channel, receiptNo, approver.id, ts);
    conn.prepare("UPDATE cash_payment_request SET status = 'VERIFIED' WHERE id = ?").run(req.id);
    // Renewal: if a paid period is still running, the new month starts when it ends.
    const running = conn.prepare("SELECT current_period_end FROM subscription WHERE org_id = ? AND status = 'ACTIVE' AND current_period_end > ? ORDER BY current_period_end DESC LIMIT 1").get(req.org_id, ts);
    const effective = running?.current_period_end ?? null;
    const subId = Number(conn.prepare(`INSERT INTO subscription (org_id, plan_code, status, provider, external_id, price_snapshot_cents, effective_at, created_at, updated_at)
      VALUES (?,?,'AWAITING_ACTIVATION','CASH',?,?,?,?,?)`).run(req.org_id, req.plan_code, `cash-${req.reference}`, req.amount_cents, effective, ts, ts).lastInsertRowid);
    conn.prepare(`INSERT INTO payment (org_id, subscription_id, provider, amount_cents, currency, status, external_id, receipt_no, paid_at, created_at)
      VALUES (?,?,'CASH',?,?,'COMPLETED',?,?,?,?)`).run(req.org_id, subId, amountCents, currency, req.reference, receiptNo, paidOn, ts);
    const link = issueMagicLink(conn, { orgId: req.org_id, userId: req.requested_by, subscriptionId: subId, baseUrl });
    conn.prepare('INSERT INTO audit_log (at, actor_user_id, org_id, action, target, meta_json) VALUES (?,?,?,?,?,?)')
      .run(ts, approver.id, req.org_id, 'CASH_VERIFIED', `cash:${req.id}`, JSON.stringify({ amountCents, channel, receiptNo, subscriptionId: subId }));
    return { subscription_id: subId, magic_link_id: link.id, delivered_to: link.email, activation_link: link.url, activation_code: link.code, expires_at: link.expires_at };
  });
}

// Each confirmed payment gets a single-use activation link and an 8-character code, both
// bound to the customer's Google account. The code reaches the customer automatically:
// in-app (notification + their Billing page) and by email when an email service is set.
// The link/code can also be sent by WhatsApp from the Approvals page.
function issueMagicLink(conn, { orgId, userId, subscriptionId, baseUrl }) {
  const token = randomToken(32);
  const code = newActivationCode();
  const ts = iso();
  const expires = new Date(now().getTime() + config.magicLinkTtlHours * 3_600_000).toISOString();
  conn.prepare('UPDATE activation_magic_link SET revoked_at = ? WHERE subscription_id = ? AND used_at IS NULL AND revoked_at IS NULL').run(ts, subscriptionId);
  const id = Number(conn.prepare('INSERT INTO activation_magic_link (token_hash, code_hash, code, org_id, user_id, subscription_id, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(sha256(token), sha256(normalizeCode(code)), code, orgId, userId, subscriptionId, expires, ts).lastInsertRowid);
  const user = conn.prepare('SELECT email, name FROM platform_user WHERE id = ?').get(userId);
  const sub = conn.prepare('SELECT s.plan_code, p.name AS plan_name FROM subscription s JOIN subscription_plan p ON p.code = s.plan_code WHERE s.id = ?').get(subscriptionId);
  // Token travels in the URL fragment, which browsers never send to servers or in Referer.
  const url = `${baseUrl}/#/activate/${token}`;
  const until = new Date(expires).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' });
  conn.prepare('INSERT INTO notification (user_id, org_id, type, body, link, created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, orgId, 'ACTIVATION_CODE', `Payment confirmed ✓ Your activation code is ${code} (${sub.plan_name}). Open Billing and press Activate. Valid until ${until} (Dubai).`, '#/billing', ts);
  queueEmail(conn, {
    userId, to: user.email, subject: `Your AI-DATA activation code: ${code}`,
    body: `Hello ${user.name},\n\nYour payment for ${sub.plan_name} is confirmed.\n\nActivation code: ${code}\n\nSign in at ${baseUrl} with Google as ${user.email}, open Billing and enter the code, or open this link:\n${url}\n\nThe code works once, only for your account, until ${until} (Dubai time).\n\nAI-DATA`,
  });
  conn.prepare('INSERT INTO audit_log (at, org_id, action, target) VALUES (?,?,?,?)').run(ts, orgId, 'MAGIC_LINK_ISSUED', `link:${id}`);
  return { id, email: user.email, expires_at: expires, url, code };
}

export function reissueMagicLink({ subscriptionId, actor, baseUrl = config.baseUrl }) {
  return tx((conn) => {
    const sub = conn.prepare("SELECT * FROM subscription WHERE id = ? AND status = 'AWAITING_ACTIVATION'").get(Number(subscriptionId));
    if (!sub) throw new HttpError(404, 'NOT_AWAITING_ACTIVATION');
    const prev = conn.prepare('SELECT user_id FROM activation_magic_link WHERE subscription_id = ? ORDER BY id DESC LIMIT 1').get(sub.id);
    const link = issueMagicLink(conn, { orgId: sub.org_id, userId: prev.user_id, subscriptionId: sub.id, baseUrl });
    conn.prepare('INSERT INTO audit_log (at, actor_user_id, org_id, action, target) VALUES (?,?,?,?,?)').run(iso(), actor.id, sub.org_id, 'MAGIC_LINK_REISSUED', `link:${link.id}`);
    return { magic_link_id: link.id, delivered_to: link.email, activation_link: link.url, activation_code: link.code, expires_at: link.expires_at };
  });
}

export function activateMagicLink({ token, user }) {
  return activateLink({ user, find: (conn) => conn.prepare('SELECT * FROM activation_magic_link WHERE token_hash = ?').get(sha256(String(token || ''))) });
}

// The code typed (or pre-filled) on the Billing page. Only the customer's own codes match.
export function activateCode({ code, user }) {
  const norm = normalizeCode(code);
  if (norm.length !== 8) return { error: 'CODE_INVALID' };
  return activateLink({ user, find: (conn) => conn.prepare('SELECT * FROM activation_magic_link WHERE code_hash = ? ORDER BY id DESC LIMIT 1').get(sha256(norm)) });
}

function activateLink({ user, find }) {
  return tx((conn) => {
    const link = find(conn);
    const fail = (code) => {
      conn.prepare('INSERT INTO audit_log (at, actor_user_id, action, target) VALUES (?,?,?,?)').run(iso(), user.id, 'MAGIC_LINK_REJECTED', code);
      return { error: code };
    };
    if (!link) return fail('LINK_INVALID');
    if (link.used_at) return fail('LINK_ALREADY_USED');
    if (link.revoked_at) return fail('LINK_REVOKED');
    if (link.expires_at < iso()) return fail('LINK_EXPIRED');
    // The link only works for the Google identity it was issued to.
    if (link.user_id !== user.id) return fail('LINK_WRONG_ACCOUNT');
    const ts = iso();
    const sub = conn.prepare('SELECT * FROM subscription WHERE id = ?').get(link.subscription_id);
    const start = sub.effective_at && sub.effective_at > ts ? sub.effective_at : ts;
    conn.prepare("UPDATE subscription SET status = 'ACTIVE', current_period_start = ?, current_period_end = ?, effective_at = ?, updated_at = ? WHERE id = ?")
      .run(start, addMonth(new Date(start)).toISOString(), start, ts, sub.id);
    if (start === ts) supersedeOthers(conn, sub.org_id, sub.id, ts);
    conn.prepare('UPDATE activation_magic_link SET used_at = ? WHERE id = ?').run(ts, link.id);
    conn.prepare('INSERT INTO audit_log (at, actor_user_id, org_id, action, target) VALUES (?,?,?,?,?)').run(ts, user.id, sub.org_id, 'MAGIC_LINK_USED', `subscription:${sub.id}`);
    return { ok: true, org_id: sub.org_id, subscription_id: sub.id };
  });
}

export function terminateSubscription({ subscriptionId, actor, reason }) {
  const sub = getDb().prepare('SELECT * FROM subscription WHERE id = ?').get(Number(subscriptionId));
  if (!sub) throw new HttpError(404, 'NOT_FOUND');
  getDb().prepare("UPDATE subscription SET status = 'CANCELLED', current_period_end = ?, updated_at = ? WHERE id = ?").run(iso(), iso(), sub.id);
  audit({ actor: actor.id, org: sub.org_id, action: 'SUBSCRIPTION_TERMINATED', target: `subscription:${sub.id}`, meta: { reason } });
  notify(getDb().prepare('SELECT owner_user_id FROM organization WHERE id = ?').get(sub.org_id).owner_user_id, sub.org_id, 'SUBSCRIPTION_TERMINATED', 'Your subscription was terminated by AI-DATA finance.', '#/billing');
}

// Unused, unexpired activation codes of this user in this organization.
export function pendingActivation(orgId, userId) {
  return getDb().prepare(`SELECT l.code, l.expires_at, s.plan_code, p.name AS plan_name FROM activation_magic_link l
      JOIN subscription s ON s.id = l.subscription_id JOIN subscription_plan p ON p.code = s.plan_code
    WHERE l.org_id = ? AND l.user_id = ? AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > ? AND s.status = 'AWAITING_ACTIVATION'
    ORDER BY l.id DESC LIMIT 1`).get(orgId, userId, iso()) || null;
}

export function billingView(orgId, userId) {
  const db = getDb();
  return {
    activation: userId ? pendingActivation(orgId, userId) : null,
    subscriptions: db.prepare('SELECT s.id, s.plan_code, s.status, s.provider, s.price_snapshot_cents, s.current_period_start, s.current_period_end, s.effective_at, s.created_at FROM subscription s WHERE org_id = ? ORDER BY id DESC').all(orgId),
    payments: db.prepare('SELECT id, provider, kind, amount_cents, currency, status, receipt_no, paid_at FROM payment WHERE org_id = ? ORDER BY paid_at DESC').all(orgId),
    cash_requests: db.prepare('SELECT id, plan_code, amount_cents, currency, reference, status, created_at FROM cash_payment_request WHERE org_id = ? ORDER BY id DESC').all(orgId),
    paypal_connected: paypalConfigured(),
    policy: {
      grace_days: config.graceDays,
      failed_renewal: config.graceDays ? `New Cold transfers continue for ${config.graceDays} day(s) after a failed renewal, then pause.` : 'New Cold transfers pause immediately when a renewal fails or the subscription is suspended.',
      cancellation: 'Cancelling stops renewal; access continues to the end of the paid period.',
      refunds: 'Refunded or reversed payments end the entitlement immediately. CRM records already lawfully transferred are kept.',
    },
  };
}
