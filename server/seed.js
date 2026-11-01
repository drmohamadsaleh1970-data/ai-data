import { getDb } from './db.js';
import { iso } from './util.js';
import { config } from './config.js';
import { PENDING_OWNER_SUB } from './auth.js';

// Reference data needed in every environment (no personal data).
export function seedBase() {
  const db = getDb();
  const plan = db.prepare(`INSERT INTO subscription_plan (code, name, price_usd_cents, cold_daily_limit, seats, raw_export_allowed, public_purchasable, hot_included)
    VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(code) DO UPDATE SET name=excluded.name, price_usd_cents=excluded.price_usd_cents, cold_daily_limit=excluded.cold_daily_limit,
    seats=excluded.seats, raw_export_allowed=excluded.raw_export_allowed, public_purchasable=excluded.public_purchasable`);
  plan.run('PLATFORM_MASTER_OWNER', 'Platform Master (internal)', null, null, 'UNLIMITED', 1, 0);
  plan.run('AGENCY_MONTHLY', 'Agency', 99900, 999, 'UNLIMITED', 0, 1);
  plan.run('AGENT_MONTHLY', 'Agent', 9900, 99, 'UNLIMITED', 0, 1);
  // Person-level subscriber transfer stays OFF until legal approval is recorded.
  db.prepare("INSERT INTO feature_flag (key, enabled, note, updated_at) VALUES ('COLD_SUBSCRIBER_TRANSFER', 0, 'Enable only after documented legal/rights approval', ?) ON CONFLICT DO NOTHING").run(iso());
  const src = db.prepare(`INSERT INTO hot_lead_source (code, name, category, status, allows_resale, isolation_required, requirements) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name, requirements = excluded.requirements`);
  [
    ['AIHOME_WEB_FORM', 'ai-home.world inquiry forms', 'First-party', 'CONNECTED', 1, 0, 'Built in. Consent captured on the form; leads land in the AI-DATA Hot pool.'],
    ['AGENCY_WEB_FORM', 'Agency website forms (site key)', 'First-party', 'CONNECTED', 0, 0, 'Built in. Embed the form with your agency site key; leads go only to your CRM.'],
    ['META_LEAD_ADS', 'Meta Facebook / Instagram Lead Ads', 'Social ads', 'NOT_CONNECTED', 0, 0, 'Meta app, Page access, leads_retrieval permission, leadgen webhook subscription.'],
    ['GOOGLE_ADS', 'Google Ads lead form assets', 'Search ads', 'NOT_CONNECTED', 0, 0, 'Google Ads account, lead form webhook URL + key.'],
    ['TIKTOK', 'TikTok Lead Generation', 'Social ads', 'NOT_CONNECTED', 0, 0, 'TikTok for Business account, Instant Form CRM integration approval.'],
    ['LINKEDIN', 'LinkedIn Lead Sync', 'Social ads', 'APPROVAL_REQUIRED', 0, 0, 'LinkedIn Lead Sync API program approval + OAuth.'],
    ['WHATSAPP', 'WhatsApp Business Platform', 'Messaging', 'NOT_CONNECTED', 0, 0, 'WhatsApp Business Account, Cloud API token, verified number, webhook.'],
    ['PROPERTY_FINDER', 'Property Finder', 'Portal', 'NOT_CONNECTED', 0, 1, 'Signed Property Finder API agreement. Leads must stay isolated: no pooling, resale or merging.'],
    ['BAYUT', 'Bayut Leads API', 'Portal', 'NOT_CONNECTED', 0, 1, 'Bayut agency account with Leads API entitlement.'],
    ['DUBIZZLE', 'Dubizzle', 'Portal', 'NOT_CONNECTED', 0, 1, 'Approved partner integration or authorized notification parsing.'],
  ].forEach((s) => src.run(...s));
}

// The platform owner comes from settings (OWNER_EMAIL, OWNER_TOTP_SECRET). Runs on every
// start: creates the owner row if missing (linked to Google on first sign-in, see
// upsertGoogleUser) and keeps its role and MFA secret in line with the settings.
export function ensureOwner() {
  const email = config.ownerEmail;
  if (!email) return null;
  const db = getDb();
  const secret = config.ownerTotpSecret || null;
  const row = db.prepare('SELECT id FROM platform_user WHERE lower(email) = ? ORDER BY id LIMIT 1').get(email);
  if (row) {
    db.prepare("UPDATE platform_user SET platform_role = 'PLATFORM_OWNER', mfa_secret = COALESCE(?, mfa_secret) WHERE id = ?").run(secret, row.id);
    return row.id;
  }
  return Number(db.prepare("INSERT INTO platform_user (google_sub, email, name, platform_role, mfa_secret, created_at) VALUES (?,?,?,'PLATFORM_OWNER',?,?)")
    .run(PENDING_OWNER_SUB + email, email, 'Platform Owner', secret, iso()).lastInsertRowid);
}
