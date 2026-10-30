import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDb } from './db.js';
import { HttpError, iso, now, randomToken, sha256, audit, verifyTotp } from './util.js';
import { config } from './config.js';

const SESSION_COOKIE = 'aih_sid';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MFA_WINDOW_MS = 10 * 60 * 1000;

// Role → permissions. Authorization is computed server-side from the membership row;
// nothing the browser sends can widen it.
export const ROLE_PERMISSIONS = {
  ORG_OWNER: ['cold.search', 'cold.transfer', 'crm.all', 'members.manage', 'billing.manage', 'usage.view', 'reports.view', 'hot.view', 'hot.buy', 'integrations.manage', 'crm.import'],
  AGENCY_DIRECTOR: ['cold.search', 'cold.transfer', 'crm.all', 'members.manage', 'billing.manage', 'usage.view', 'reports.view', 'hot.view', 'hot.buy', 'integrations.manage', 'crm.import'],
  ORG_ADMIN: ['cold.search', 'cold.transfer', 'crm.all', 'members.manage', 'usage.view', 'reports.view', 'hot.view', 'integrations.manage', 'crm.import'],
  SALES_MANAGER: ['cold.search', 'cold.transfer', 'crm.all', 'usage.view', 'reports.view', 'hot.view', 'crm.import'],
  TEAM_LEADER: ['cold.search', 'cold.transfer', 'crm.all', 'usage.view', 'reports.view', 'hot.view'],
  AGENT: ['cold.search', 'cold.transfer', 'crm.own', 'usage.view', 'hot.view'],
  MARKETING_MANAGER: ['cold.search', 'usage.view', 'reports.view', 'hot.view'],
  AUDITOR: ['usage.view', 'reports.view'],
};
export const ORG_ROLES = Object.keys(ROLE_PERMISSIONS);

// --- Sessions ------------------------------------------------------------------------
export function createSession(res, userId) {
  const sid = randomToken();
  const db = getDb();
  const firstOrg = db.prepare("SELECT org_id FROM membership WHERE user_id = ? AND status='ACTIVE' ORDER BY id LIMIT 1").get(userId);
  db.prepare('INSERT INTO session (id_hash, user_id, active_org_id, expires_at, created_at) VALUES (?,?,?,?,?)')
    .run(sha256(sid), userId, firstOrg?.org_id ?? null, new Date(now().getTime() + SESSION_TTL_MS).toISOString(), iso());
  res.cookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: SESSION_TTL_MS, path: '/' });
  return sid;
}

export function destroySession(req, res) {
  const sid = readCookie(req, SESSION_COOKIE);
  if (sid) getDb().prepare('DELETE FROM session WHERE id_hash = ?').run(sha256(sid));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Attaches req.user / req.session / req.membership if a valid session cookie exists.
export function loadSession(req, _res, next) {
  const sid = readCookie(req, SESSION_COOKIE);
  if (!sid) return next();
  const db = getDb();
  const s = db.prepare('SELECT * FROM session WHERE id_hash = ?').get(sha256(sid));
  if (!s || s.expires_at < iso()) return next();
  req.session = s;
  req.user = db.prepare('SELECT * FROM platform_user WHERE id = ?').get(s.user_id);
  if (s.active_org_id) {
    req.membership = db.prepare("SELECT * FROM membership WHERE org_id = ? AND user_id = ? AND status='ACTIVE'").get(s.active_org_id, s.user_id) || null;
  }
  next();
}

// State-changing requests must carry a custom header; combined with SameSite cookies
// this blocks cross-site form posts (CSRF).
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/webhooks/') || req.path.startsWith('/api/public/')) return next();
  if (req.get('x-aihome-csrf') !== '1') return next(new HttpError(403, 'CSRF_HEADER_MISSING'));
  next();
}

export const requireUser = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'AUTH_REQUIRED')));

export function requireOrgPermission(perm) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'AUTH_REQUIRED'));
    if (!req.membership) return next(new HttpError(403, 'NO_ACTIVE_ORGANIZATION'));
    if (!ROLE_PERMISSIONS[req.membership.role]?.includes(perm)) return next(new HttpError(403, 'FORBIDDEN', `Missing permission ${perm}`));
    next();
  };
}

export const hasPerm = (req, perm) => !!req.membership && ROLE_PERMISSIONS[req.membership.role]?.includes(perm);

export function requirePlatformRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'AUTH_REQUIRED'));
    if (!roles.includes(req.user.platform_role)) {
      audit({ actor: req.user.id, action: 'PLATFORM_ACCESS_DENIED', target: req.originalUrl });
      return next(new HttpError(403, 'PLATFORM_ROLE_REQUIRED'));
    }
    next();
  };
}

// Step-up MFA: owner exports and finance approvals need a TOTP verification in the
// last 10 minutes on this session.
export function requireRecentMfa(req, _res, next) {
  const at = req.session?.mfa_verified_at;
  if (!at || now().getTime() - new Date(at).getTime() > MFA_WINDOW_MS) return next(new HttpError(401, 'MFA_REQUIRED'));
  next();
}

export function verifyMfa(req, code) {
  if (!req.user.mfa_secret) throw new HttpError(400, 'MFA_NOT_ENROLLED');
  if (!verifyTotp(req.user.mfa_secret, code)) {
    audit({ actor: req.user.id, action: 'MFA_FAILED' });
    throw new HttpError(401, 'MFA_INVALID');
  }
  getDb().prepare('UPDATE session SET mfa_verified_at = ? WHERE id_hash = ?').run(iso(), req.session.id_hash);
  audit({ actor: req.user.id, action: 'MFA_VERIFIED' });
}

// --- Google Identity Services (OIDC ID token) ----------------------------------------
let jwks;
export async function verifyGoogleCredential(credential, expectedNonce) {
  if (!config.googleClientId) throw new HttpError(503, 'GOOGLE_NOT_CONFIGURED', 'Set GOOGLE_CLIENT_ID to enable Google sign-in.');
  jwks ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  const { payload } = await jwtVerify(credential, jwks, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.googleClientId,
  });
  if (!payload.email_verified) throw new HttpError(401, 'GOOGLE_EMAIL_NOT_VERIFIED');
  if (!expectedNonce || payload.nonce !== expectedNonce) throw new HttpError(401, 'GOOGLE_NONCE_MISMATCH');
  return { sub: payload.sub, email: payload.email, name: payload.name || payload.email };
}

// Upsert by Google subject. Email/name may change; `sub` is the stable identity.
// Platform roles are never assigned here.
export function upsertGoogleUser({ sub, email, name }) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM platform_user WHERE google_sub = ?').get(sub);
  if (existing) {
    db.prepare('UPDATE platform_user SET email = ?, name = ? WHERE id = ?').run(email, name, existing.id);
    return existing.id;
  }
  return Number(db.prepare('INSERT INTO platform_user (google_sub, email, name, created_at) VALUES (?,?,?,?)').run(sub, email, name, iso()).lastInsertRowid);
}

export { readCookie, SESSION_COOKIE };
