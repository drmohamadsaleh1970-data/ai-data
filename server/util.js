import crypto from 'node:crypto';
import { getDb } from './db.js';

// Injectable clock so tests can cross the Dubai midnight boundary deterministically.
let clockOffsetMs = 0;
export const now = () => new Date(Date.now() + clockOffsetMs);
export const setClockOffset = (ms) => { clockOffsetMs = ms; };
export const iso = (d = now()) => d.toISOString();

export const QUOTA_TZ = 'Asia/Dubai';

// Calendar day in Asia/Dubai, independent of server timezone.
export function dubaiDay(d = now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Next 00:00 Asia/Dubai as an ISO instant. Dubai is UTC+4 with no DST; the offset is
// still derived from Intl so this stays correct if the rule ever changes.
export function nextDubaiMidnight(d = now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: QUOTA_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = localAsUtc - Math.floor(d.getTime() / 1000) * 1000;
  const nextLocalMidnight = Date.UTC(+parts.year, +parts.month - 1, +parts.day + 1);
  return new Date(nextLocalMidnight - offset).toISOString();
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Mobile numbers are stored in international form (+9715xxxxxxxx). A local UAE number
// starting with 0 (e.g. 050 123 4567) is read as +971; anything else needs its country code.
export function requireMobile(input) {
  let p = String(input ?? '').trim().replace(/[\s().-]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  else if (/^0\d{8,9}$/.test(p)) p = '+971' + p.slice(1);
  else if (/^\d{10,15}$/.test(p)) p = '+' + p;
  if (!/^\+[1-9]\d{7,14}$/.test(p)) throw new HttpError(400, 'INVALID_PHONE', 'Enter a mobile number with country code, e.g. +971 50 123 4567.');
  return p;
}

export function cleanName(input) {
  const n = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 120 || !/\p{L}/u.test(n)) throw new HttpError(400, 'INVALID_NAME', 'Enter your full name.');
  return n;
}

export const cleanEmail = (input) => {
  const e = String(input ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 200) throw new HttpError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return e;
};

export function audit({ actor, org, action, target, meta }) {
  getDb().prepare('INSERT INTO audit_log (at, actor_user_id, org_id, action, target, meta_json) VALUES (?,?,?,?,?,?)')
    .run(iso(), actor ?? null, org ?? null, action, target ?? null, meta ? JSON.stringify(meta) : null);
}

export function notify(userId, orgId, type, body, link) {
  getDb().prepare('INSERT INTO notification (user_id, org_id, type, body, link, created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, orgId ?? null, type, body, link ?? null, iso());
}

export function flag(key) {
  const row = getDb().prepare('SELECT enabled FROM feature_flag WHERE key = ?').get(key);
  return !!row?.enabled;
}

// --- Masking: subscriber previews never carry raw PII in the payload. -------------
export function maskName(name) {
  return String(name).split(/\s+/).filter(Boolean).map((p) => p[0].toUpperCase() + '•••').join(' ');
}
export function maskEmail(email) {
  if (!email) return null;
  const [u, d] = email.split('@');
  const tld = d?.split('.').pop();
  return `${u[0]}•••@•••.${tld}`;
}
export function maskPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return `+${digits.slice(0, 3)} ••• ••${digits.slice(-2)}`;
}

// --- TOTP (RFC 6238) for owner / finance step-up MFA ----------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function base32Decode(s) {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret, t = now().getTime(), step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step)));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
export function verifyTotp(secret, code) {
  if (!secret || !/^\d{6}$/.test(String(code))) return false;
  const t = now().getTime();
  return [-30_000, 0, 30_000].some((d) => crypto.timingSafeEqual(Buffer.from(totp(secret, t + d)), Buffer.from(String(code))));
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
