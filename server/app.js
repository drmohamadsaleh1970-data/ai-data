import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { config, paypalConfigured } from './config.js';
import { HttpError, iso, audit, randomToken, sha256, newTotpSecret, totp, dubaiDay } from './util.js';
import {
  loadSession, csrfGuard, requireUser, requireOrgPermission, requirePlatformRole, requireRecentMfa, verifyMfa,
  createSession, destroySession, verifyGoogleCredential, upsertGoogleUser, ROLE_PERMISSIONS, ORG_ROLES, readCookie,
} from './auth.js';
import { entitlementSummary } from './entitlements.js';
import * as cold from './cold.js';
import * as billing from './billing.js';
import * as crm from './crm.js';
import * as hot from './hot.js';
import * as owner from './owner.js';
import * as source from './source-aihome.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

// options.testLogin adds a sign-in for the automated tests' fictional personas. The
// production entry points (api/index.js, server/index.js) never pass it.
export function createApp(options = {}) {
  const app = express();
  app.locals.ORG_ROLES = ORG_ROLES;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com/; connect-src 'self' https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.googleusercontent.com",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });
  // Public intake (lead forms on other websites, Zapier/Make) uses no cookies and is
  // authenticated by a site key, so any origin may call it.
  app.use('/api/public', (req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Site-Key', 'Access-Control-Max-Age': '86400' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '12mb' }));
  app.use(loadSession);
  app.use(csrfGuard);
  const r = express.Router();
  const ok = (fn) => async (req, res) => res.json(await fn(req, res));
  const orgId = (req) => req.membership.org_id;
  // Address used in activation links: BASE_URL if set, otherwise the address the request came in on.
  const publicBase = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

  // --- Public ------------------------------------------------------------------------
  r.get('/health', ok(() => ({ ok: true, time: iso(), quota_day_dubai: dubaiDay() })));
  r.get('/public/plans', ok(() => ({
    plans: getDb().prepare('SELECT code, name, price_usd_cents, cold_daily_limit, seats, raw_export_allowed, hot_included FROM subscription_plan WHERE public_purchasable = 1 ORDER BY price_usd_cents DESC').all(),
    hot: hot.pricing(),
  })));
  r.get('/auth/config', (req, res) => {
    const nonce = randomToken(16);
    res.cookie('aih_nonce', nonce, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 10 * 60_000, path: '/' });
    res.json({ google_client_id: config.googleClientId || null, nonce, demo_mode: config.demoMode, paypal_connected: paypalConfigured() });
  });
  r.post('/auth/google', ok(async (req, res) => {
    const ident = await verifyGoogleCredential(String(req.body.credential || ''), readCookie(req, 'aih_nonce'));
    const userId = upsertGoogleUser(ident);
    crm.acceptInvitations(getDb().prepare('SELECT * FROM platform_user WHERE id = ?').get(userId));
    createSession(res, userId);
    audit({ actor: userId, action: 'LOGIN_GOOGLE' });
    return { ok: true };
  }));
  // "Sign in as" a demo persona. Only exists while DEMO_MODE is on.
  r.post('/auth/demo', ok((req, res) => {
    if (!config.demoMode) throw new HttpError(404, 'NOT_FOUND');
    const u = getDb().prepare("SELECT * FROM platform_user WHERE google_sub = ? AND google_sub LIKE 'demo|%'").get(`demo|${req.body.persona}`);
    if (!u) throw new HttpError(404, 'UNKNOWN_PERSONA');
    crm.acceptInvitations(u);
    createSession(res, u.id);
    audit({ actor: u.id, action: 'LOGIN_DEMO' });
    return { ok: true };
  }));
  // Fills the MFA code for demo personas only (they have no authenticator app).
  r.get('/demo/totp', requireUser, ok((req) => {
    if (!config.demoMode || !req.user.mfa_secret || !String(req.user.google_sub).startsWith('demo|')) throw new HttpError(404, 'NOT_FOUND');
    return { code: totp(req.user.mfa_secret) };
  }));
  if (options.testLogin) {
    r.post('/test/login', ok((req, res) => {
      const u = getDb().prepare('SELECT * FROM platform_user WHERE google_sub = ?').get(`fixture|${req.body.persona}`);
      if (!u) throw new HttpError(404, 'UNKNOWN_PERSONA');
      crm.acceptInvitations(u);
      createSession(res, u.id);
      return { ok: true };
    }));
    r.get('/test/totp', requireUser, ok((req) => ({ code: totp(req.user.mfa_secret) })));
  }
  r.post('/auth/logout', ok((req, res) => { destroySession(req, res); return { ok: true }; }));
  r.post('/public/inquiry', ok((req) => hot.intakeInquiry({ siteKey: req.get('x-site-key') || req.body.site_key, body: req.body || {}, ip: req.ip, origin: req.get('origin') })));
  r.post('/public/search-event', ok((req) => hot.recordSearchEvent(req.body || {})));
  r.post('/webhooks/paypal', ok((req) => billing.handlePaypalWebhook(req.headers, req.body)));

  // --- Me / organizations ---------------------------------------------------------------
  r.get('/me', ok((req) => {
    if (!req.user) return { authenticated: false };
    const db = getDb();
    const memberships = db.prepare("SELECT m.org_id, m.role, o.name, o.kind FROM membership m JOIN organization o ON o.id = m.org_id WHERE m.user_id = ? AND m.status='ACTIVE'").all(req.user.id);
    return {
      authenticated: true,
      user: { id: req.user.id, name: req.user.name, email: req.user.email, locale: req.user.locale, platform_role: req.user.platform_role, mfa_enrolled: !!req.user.mfa_secret },
      memberships,
      active_org: req.membership ? memberships.find((m) => m.org_id === req.membership.org_id) : null,
      permissions: req.membership ? ROLE_PERMISSIONS[req.membership.role] : [],
      entitlements: req.membership ? entitlementSummary(req.membership.org_id) : null,
      unread_notifications: db.prepare('SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n,
      demo_mode: config.demoMode,
    };
  }));
  r.post('/me/active-org', requireUser, ok((req) => {
    const m = getDb().prepare("SELECT 1 FROM membership WHERE org_id = ? AND user_id = ? AND status='ACTIVE'").get(Number(req.body.org_id), req.user.id);
    if (!m) throw new HttpError(403, 'NOT_A_MEMBER');
    getDb().prepare('UPDATE session SET active_org_id = ? WHERE id_hash = ?').run(Number(req.body.org_id), req.session.id_hash);
    return { ok: true };
  }));
  r.post('/me/preferences', requireUser, ok((req) => {
    if (!['en', 'ar', 'fr', 'ru', 'tr'].includes(req.body.locale)) throw new HttpError(400, 'UNSUPPORTED_LOCALE');
    getDb().prepare('UPDATE platform_user SET locale = ? WHERE id = ?').run(req.body.locale, req.user.id);
    return { ok: true };
  }));
  r.get('/me/notifications', requireUser, ok((req) => getDb().prepare('SELECT * FROM notification WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id)));
  r.post('/me/notifications/read', requireUser, ok((req) => { getDb().prepare('UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(iso(), req.user.id); return { ok: true }; }));
  r.post('/me/mfa/verify', requireUser, ok((req) => { verifyMfa(req, req.body.code); return { ok: true }; }));
  r.get('/me/entitlements', requireOrgPermission('usage.view'), ok((req) => entitlementSummary(orgId(req))));

  r.post('/organizations', requireUser, ok((req) => {
    const b = req.body || {};
    if (!b.name || String(b.name).length > 120) throw new HttpError(400, 'NAME_REQUIRED');
    if (!['AGENCY', 'AGENT'].includes(b.kind)) throw new HttpError(400, 'INVALID_KIND');
    if (b.terms !== true) throw new HttpError(400, 'TERMS_REQUIRED');
    const db = getDb();
    const ts = iso();
    const id = Number(db.prepare('INSERT INTO organization (name, kind, owner_user_id, business_contact, license_no, language, timezone, terms_accepted_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(String(b.name), b.kind, req.user.id, b.business_contact ?? null, b.license_no ?? null, b.language || 'en', b.timezone || 'Asia/Dubai', ts, ts).lastInsertRowid);
    db.prepare("INSERT INTO membership (org_id, user_id, role, created_at) VALUES (?,?,'ORG_OWNER',?)").run(id, req.user.id, ts);
    db.prepare('UPDATE session SET active_org_id = ? WHERE id_hash = ?').run(id, req.session.id_hash);
    audit({ actor: req.user.id, org: id, action: 'ORGANIZATION_CREATED' });
    return { id };
  }));
  r.get('/organizations/:id/usage', requireOrgPermission('usage.view'), ok((req) => {
    if (Number(req.params.id) !== orgId(req)) throw new HttpError(403, 'FORBIDDEN');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : undefined;
    return cold.usage(orgId(req), day);
  }));
  r.get('/org/members', requireOrgPermission('usage.view'), ok((req) => crm.members(orgId(req))));
  r.post('/org/invitations', requireOrgPermission('members.manage'), ok((req) => crm.invite(req, req.body || {})));
  r.delete('/org/members/:userId', requireOrgPermission('members.manage'), ok((req) => { crm.removeMember(req, req.params.userId); return { ok: true }; }));

  // --- Billing ---------------------------------------------------------------------------
  r.get('/billing', requireOrgPermission('usage.view'), ok((req) => billing.billingView(orgId(req))));
  r.post('/billing/paypal', requireOrgPermission('billing.manage'), ok((req) => billing.startPaypalCheckout({ orgId: orgId(req), planCode: req.body.plan, user: req.user })));
  r.post('/billing/cash', requireOrgPermission('billing.manage'), ok((req) => billing.requestCash({ orgId: orgId(req), planCode: req.body.plan, user: req.user, note: req.body.note })));
  r.post('/billing/activate', requireUser, ok((req) => {
    const out = billing.activateMagicLink({ token: req.body.token, user: req.user });
    if (out.error) throw new HttpError(400, out.error);
    getDb().prepare('UPDATE session SET active_org_id = ? WHERE id_hash = ?').run(out.org_id, req.session.id_hash);
    return out;
  }));

  // --- Cold data -------------------------------------------------------------------------
  r.get('/cold/filters', requireOrgPermission('cold.search'), ok(() => cold.filterOptions()));
  r.post('/cold/search', requireOrgPermission('cold.search'), ok((req) => cold.search({ orgId: orgId(req), filter: req.body.filter, cursor: req.body.cursor, limit: req.body.limit })));
  r.post('/cold/transfers/estimate', requireOrgPermission('cold.transfer'), ok((req) => cold.estimate({ orgId: orgId(req), selection: req.body.selection })));
  r.post('/cold/transfers', requireOrgPermission('cold.transfer'), ok((req) => cold.transfer({
    membership: req.membership, selection: req.body.selection, idempotencyKey: req.get('idempotency-key'),
    allowPartial: req.body.allow_partial === true, assignTo: req.body.assign_to, campaignTag: req.body.campaign_tag,
  })));
  r.get('/cold/transfers/:jobId', requireOrgPermission('usage.view'), ok((req) => cold.getJob(orgId(req), req.params.jobId)));
  r.get('/cold/acquired', requireOrgPermission('cold.search'), ok((req) => cold.acquiredList(orgId(req))));
  r.get('/cold/presets', requireOrgPermission('cold.search'), ok((req) => getDb().prepare('SELECT id, name, filter_json, created_at FROM cold_filter_preset WHERE org_id = ? ORDER BY id DESC').all(orgId(req))));
  r.post('/cold/presets', requireOrgPermission('cold.search'), ok((req) => {
    const f = cold.parseFilter(req.body.filter);
    getDb().prepare('INSERT INTO cold_filter_preset (org_id, user_id, name, filter_json, created_at) VALUES (?,?,?,?,?)').run(orgId(req), req.user.id, String(req.body.name || 'Saved search').slice(0, 80), JSON.stringify(f), iso());
    return { ok: true };
  }));

  // Guessable raw-export routes are hard-denied for every non-owner session.
  const denyExport = (req) => {
    audit({ actor: req.user?.id, org: req.membership?.org_id, action: 'RAW_EXPORT_DENIED', target: req.originalUrl });
    throw new HttpError(403, 'EXPORT_NOT_PERMITTED', 'Individual Cold contact data can only be transferred into your CRM. Raw exports are not available on subscriber plans.');
  };
  r.all(/^\/(investor-history|cold|crm)\/(export|download|print|csv|xlsx|dump)(\/.*)?$/, ok(denyExport));

  // --- CRM -------------------------------------------------------------------------------
  const crmPerm = (req, _res, next) => (req.membership && (ROLE_PERMISSIONS[req.membership.role].includes('crm.all') || ROLE_PERMISSIONS[req.membership.role].includes('crm.own')) ? next() : next(new HttpError(req.user ? 403 : 401, req.user ? 'FORBIDDEN' : 'AUTH_REQUIRED')));
  r.get('/crm/leads', crmPerm, ok((req) => crm.listLeads(req, req.query)));
  r.get('/crm/leads/:id', crmPerm, ok((req) => crm.leadDetail(req, req.params.id)));
  r.patch('/crm/leads/:id', crmPerm, ok((req) => crm.updateLead(req, req.params.id, req.body || {})));
  r.post('/crm/leads/:id/activities', crmPerm, ok((req) => crm.addActivity(req, req.params.id, req.body || {})));
  r.post('/crm/leads/:id/tasks', crmPerm, ok((req) => crm.addTask(req, req.params.id, req.body || {})));
  r.get('/crm/tasks', crmPerm, ok((req) => crm.myTasks(req)));
  r.post('/crm/tasks/:id/complete', crmPerm, ok((req) => crm.completeTask(req, req.params.id)));
  r.get('/crm/pipeline', crmPerm, ok((req) => ({ stages: crm.pipeline(req) })));
  r.post('/crm/import', requireOrgPermission('crm.import'), ok((req) => crm.importLeadsXlsx(req, { base64: req.body.file_base64, commit: req.body.commit === true, rightsConfirmed: req.body.rights_confirmed === true })));
  r.get('/reports', requireOrgPermission('reports.view'), ok((req) => crm.reports(req)));
  r.get('/hot', requireOrgPermission('hot.view'), ok((req) => hot.orgHotView(orgId(req))));
  r.get('/integrations', requireUser, ok(() => ({ sources: hot.sources(), paypal: paypalConfigured() ? 'CONNECTED' : 'NOT_CONNECTED', google_sign_in: config.googleClientId ? 'CONNECTED' : 'NOT_CONNECTED' })));

  // --- Platform owner / finance ---------------------------------------------------------
  const OWNER = requirePlatformRole('PLATFORM_OWNER');
  const FINANCE = requirePlatformRole('PLATFORM_OWNER', 'PLATFORM_FINANCE_ADMIN');
  r.post('/owner/bootstrap', requireUser, ok((req) => {
    const db = getDb();
    if (db.prepare("SELECT 1 FROM platform_user WHERE platform_role = 'PLATFORM_OWNER'").get()) throw new HttpError(409, 'OWNER_ALREADY_BOOTSTRAPPED');
    const row = db.prepare('SELECT * FROM owner_bootstrap WHERE token_hash = ?').get(sha256(String(req.body.token || '')));
    if (!row || row.used_at || row.expires_at < iso() || row.email.toLowerCase() !== req.user.email.toLowerCase()) {
      audit({ actor: req.user.id, action: 'OWNER_BOOTSTRAP_REJECTED' });
      throw new HttpError(403, 'BOOTSTRAP_TOKEN_INVALID');
    }
    const secret = newTotpSecret();
    db.prepare("UPDATE platform_user SET platform_role = 'PLATFORM_OWNER', mfa_secret = ? WHERE id = ?").run(secret, req.user.id);
    db.prepare('UPDATE owner_bootstrap SET used_at = ?, used_by = ? WHERE id = ?').run(iso(), req.user.id, row.id);
    audit({ actor: req.user.id, action: 'OWNER_BOOTSTRAPPED' });
    return { otpauth_url: `otpauth://totp/AI-DATA:${encodeURIComponent(req.user.email)}?secret=${secret}&issuer=AI-DATA`, secret };
  }));
  r.get('/owner/dashboard', FINANCE, ok(() => owner.dashboard()));
  r.post('/owner/cold/search', OWNER, ok((req) => {
    audit({ actor: req.user.id, action: 'OWNER_PII_SEARCH', meta: { filter: req.body.filter } });
    return cold.search({ orgId: null, filter: req.body.filter, cursor: req.body.cursor, limit: req.body.limit, ownerView: true });
  }));
  r.get('/owner/cold/filters', OWNER, ok(() => cold.filterOptions()));
  r.get('/owner/export-fields', OWNER, ok(() => Object.keys(owner.EXPORT_FIELDS)));
  r.post('/owner/cold-exports', OWNER, requireRecentMfa, ok((req) => owner.createOwnerExport({ user: req.user, filter: req.body.filter, fields: req.body.fields })));
  r.get('/owner/cold-exports/:jobId', OWNER, requireRecentMfa, (req, res) => {
    const f = owner.exportFile(req.params.jobId, req.user);
    // The path is server-generated (never user input), so serving from a dot-folder is safe.
    res.download(f.file, f.name, { dotfiles: 'allow' });
  });
  r.post('/owner/cash/:id/verify', FINANCE, requireRecentMfa, ok((req) => billing.verifyCash({
    requestId: req.params.id, approver: req.user, amountCents: Math.round(Number(req.body.amount_aed ?? req.body.amount_usd) * 100), currency: req.body.currency || 'AED',
    paidOn: req.body.paid_on, channel: req.body.channel, receiptNo: req.body.receipt_no, baseUrl: publicBase(req),
  })));
  r.post('/owner/cash/:id/reject', FINANCE, ok((req) => {
    getDb().prepare("UPDATE cash_payment_request SET status = 'REJECTED' WHERE id = ? AND status = 'PENDING_PAYMENT'").run(Number(req.params.id));
    audit({ actor: req.user.id, action: 'CASH_REJECTED', target: `cash:${req.params.id}` });
    return { ok: true };
  }));
  r.post('/owner/subscriptions/:id/reissue-link', FINANCE, requireRecentMfa, ok((req) => billing.reissueMagicLink({ subscriptionId: req.params.id, actor: req.user, baseUrl: publicBase(req) })));
  r.post('/owner/subscriptions/:id/terminate', FINANCE, requireRecentMfa, ok((req) => { billing.terminateSubscription({ subscriptionId: req.params.id, actor: req.user, reason: req.body.reason }); return { ok: true }; }));
  r.get('/owner/hot', OWNER, ok(() => ({ pricing: hot.pricing(), pool: hot.pool(), sources: hot.sources(), site_keys: hot.siteKeys() })));
  r.post('/owner/hot/site-keys', OWNER, ok((req) => hot.createSiteKey({ actor: req.user, orgId: req.body.org_id || null, label: req.body.label, allowedOrigin: req.body.allowed_origin })));
  r.post('/owner/hot/site-keys/:key/revoke', OWNER, ok((req) => hot.revokeSiteKey({ actor: req.user, key: req.params.key })));
  r.post('/owner/hot/pricing', OWNER, requireRecentMfa, ok((req) => hot.configurePricing({ actor: req.user, model: req.body.model, priceCents: Math.round(Number(req.body.price_aed ?? req.body.price_usd) * 100), exclusive: req.body.exclusive !== false })));
  r.post('/owner/hot/entitlements', OWNER, requireRecentMfa, ok((req) => hot.grantEntitlement({ actor: req.user, orgId: req.body.org_id, credits: Number(req.body.credits) })));
  r.post('/owner/hot/pool/:id/allocate', OWNER, ok((req) => hot.allocate({ actor: req.user, poolId: req.params.id, orgId: req.body.org_id })));
  // ai-home.world investor-data source (import only; this portal is standalone).
  r.get('/owner/source', OWNER, ok(() => source.sourceStatus()));
  r.post('/owner/source/preview', OWNER, ok(async (req) => {
    const { parsed, ...summary } = source.preview(await source.parseFile(req.body.file_base64, req.body.file_name));
    return { ...summary, sample: parsed.filter((p) => !p.errors.length).slice(0, 5).map((p) => p.record) };
  }));
  r.post('/owner/source/import', OWNER, requireRecentMfa, ok(async (req) => source.importRows({
    rows: await source.parseFile(req.body.file_base64, req.body.file_name), actor: req.user, mode: 'FILE', fileName: String(req.body.file_name || '').slice(0, 200),
  })));
  r.post('/owner/source/sync', OWNER, requireRecentMfa, ok((req) => source.syncFromApi({ actor: req.user })));
  r.get('/owner/provenance', OWNER, ok(() => owner.provenanceList()));
  r.post('/owner/provenance/:id/review', OWNER, requireRecentMfa, ok((req) => { owner.reviewProvenance({ actor: req.user, id: req.params.id, allowTransfer: req.body.allow_transfer === true }); return { ok: true }; }));
  r.post('/owner/investors/:id/suppress', OWNER, ok((req) => owner.suppressInvestor({ actor: req.user, investorId: req.params.id, reason: req.body.reason })));
  r.get('/owner/flags', OWNER, ok(() => getDb().prepare('SELECT * FROM feature_flag').all()));
  r.post('/owner/flags', OWNER, requireRecentMfa, ok((req) => { owner.setFlag({ actor: req.user, key: req.body.key, enabled: req.body.enabled === true }); return { ok: true }; }));
  r.get('/owner/audit', OWNER, ok((req) => owner.auditLog(req.query)));

  app.use('/api', r);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND')));
  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
  app.get(['/investor-history', '/pricing'], (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR'), message: status === 500 ? 'Internal error' : err.message, ...(err.extra || {}) });
  });
  return app;
}
