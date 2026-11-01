// Google Ads lead forms (lead form assets on Search, YouTube, Discovery/Demand Gen ads).
// In Google Ads → the lead form → "Lead delivery" → Webhook integration, paste
//   Webhook URL: https://<portal>/api/webhooks/google-ads
//   Key:         the key shown for the connection in Lead generation
// Google then posts every lead within seconds, with the key in `google_key`. Leads are
// deduplicated by Google's lead_id. "Send test data" leads are stored but marked as tests
// and never distributed or billed.
import { getDb } from './db.js';
import { HttpError, iso, audit, randomToken } from './util.js';
import { normalizePhone } from './crm.js';
import { ingest, afterIngest } from './hot.js';
import { mapFields } from './meta.js';

export const WEBHOOK_PATH = '/api/webhooks/google-ads';
const STANDARD = new Set(['FULL_NAME', 'FIRST_NAME', 'LAST_NAME', 'EMAIL', 'WORK_EMAIL', 'PHONE_NUMBER', 'WORK_PHONE', 'CITY', 'REGION', 'COUNTRY', 'POSTAL_CODE', 'COMPANY_NAME', 'JOB_TITLE']);

export function listHooks({ orgId = null, all = false } = {}) {
  const db = getDb();
  const sql = `SELECT h.id, h.label, h.hook_key, h.org_id, o.name AS org_name, h.campaign_id, k.name AS campaign_name, h.status, h.last_lead_at, h.created_at
    FROM google_ads_hook h LEFT JOIN organization o ON o.id = h.org_id LEFT JOIN lead_campaign k ON k.id = h.campaign_id`;
  const rows = all ? db.prepare(`${sql} ORDER BY h.id DESC`).all() : db.prepare(`${sql} WHERE h.org_id = ? ORDER BY h.id DESC`).all(Number(orgId));
  return { webhook_path: WEBHOOK_PATH, hooks: rows };
}

export function createHook({ actor, orgId, label, campaign_id }) {
  const db = getDb();
  const name = String(label || '').trim().slice(0, 120);
  if (!name) throw new HttpError(400, 'LABEL_REQUIRED', 'Name the connection, e.g. the Google Ads account or campaign.');
  if (orgId != null && !db.prepare('SELECT 1 FROM organization WHERE id = ?').get(Number(orgId))) throw new HttpError(404, 'ORG_NOT_FOUND');
  let campaignId = null;
  if (campaign_id) {
    const c = db.prepare('SELECT id, org_id FROM lead_campaign WHERE id = ?').get(Number(campaign_id));
    if (!c || (c.org_id == null ? null : Number(c.org_id)) !== (orgId == null ? null : Number(orgId))) throw new HttpError(400, 'CAMPAIGN_DESTINATION_MISMATCH', 'Choose a campaign that sends leads to the same place.');
    campaignId = Number(c.id);
  }
  const key = `gak_${randomToken(18)}`;
  const id = Number(db.prepare("INSERT INTO google_ads_hook (label, hook_key, org_id, campaign_id, status, created_by, created_at) VALUES (?,?,?,?,'ACTIVE',?,?)")
    .run(name, key, orgId ?? null, campaignId, actor.id, iso()).lastInsertRowid);
  audit({ actor: actor.id, org: orgId ?? null, action: 'GOOGLE_ADS_HOOK_CREATED', target: `google_ads_hook:${id}` });
  db.prepare("UPDATE hot_lead_source SET status = 'CONNECTED' WHERE code = 'GOOGLE_ADS'").run();
  return { id, label: name, hook_key: key, org_id: orgId ?? null, campaign_id: campaignId, webhook_path: WEBHOOK_PATH };
}

export function deleteHook({ actor, id, orgId = null, owner = false }) {
  const db = getDb();
  const h = db.prepare('SELECT * FROM google_ads_hook WHERE id = ?').get(Number(id));
  if (!h || (!owner && Number(h.org_id) !== Number(orgId))) throw new HttpError(404, 'NOT_FOUND');
  db.prepare('DELETE FROM google_ads_hook WHERE id = ?').run(h.id);
  audit({ actor: actor.id, org: h.org_id, action: 'GOOGLE_ADS_HOOK_REMOVED', target: `google_ads_hook:${h.id}` });
  if (!Number(db.prepare('SELECT COUNT(*) AS n FROM google_ads_hook').get().n)) db.prepare("UPDATE hot_lead_source SET status = 'NOT_CONNECTED' WHERE code = 'GOOGLE_ADS'").run();
  return { deleted: true };
}

// POST /api/webhooks/google-ads
export function handleLead(body = {}) {
  const db = getDb();
  const hook = db.prepare("SELECT * FROM google_ads_hook WHERE hook_key = ? AND status = 'ACTIVE'").get(String(body.google_key || ''));
  if (!hook) throw new HttpError(403, 'INVALID_GOOGLE_KEY');
  if (!body.lead_id) throw new HttpError(400, 'LEAD_ID_REQUIRED');
  // Standard fields come with Google's own ids (FULL_NAME, PHONE_NUMBER, EMAIL…); custom
  // questions are recognised by their question text (area, budget, bedrooms…).
  const fields = (body.user_column_data || []).map((c) => {
    const id = String(c.column_id || '').toUpperCase();
    const key = STANDARD.has(id) ? id : String(c.column_name || c.column_id || '');
    return { name: key.toLowerCase().trim().replace(/\s+/g, '_'), values: [c.string_value ?? ''] };
  });
  const f = mapFields(fields);
  const phone = normalizePhone(f.phone);
  const email = f.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) ? String(f.email).toLowerCase() : null;
  if (!f.full_name || (!phone && !email)) throw new HttpError(400, 'NAME_AND_CONTACT_REQUIRED');
  const test = body.is_test === true || body.is_test === 'true';
  const r = ingest({
    orgId: hook.org_id, sourceCode: 'GOOGLE_ADS', eventKey: `${hook.id}:${body.lead_id}`,
    fullName: `${f.full_name.slice(0, 100)}${test ? ' (Google test lead)' : ''}`, email, phone, language: null,
    interest: { area: f.area, property_type: f.property_type, bedrooms: f.bedrooms, budget_max_aed: f.budget_max_aed, message: f.message },
    // Google lead forms show the advertiser's privacy policy and are submitted to be contacted.
    consent: { contact: true, marketing: false, notice_version: `google-lead-form-${body.form_id || 'unknown'}`, captured_at: iso(), channel: 'GOOGLE_ADS_LEAD_FORM', form_id: body.form_id ?? null, gclid: body.gcl_id ?? null, test },
    detail: `GOOGLE_ADS:${hook.label}`, campaignId: hook.campaign_id ?? null,
    utm: { utm_source: 'google', utm_medium: 'lead_form', ...(body.campaign_id ? { utm_campaign: String(body.campaign_id).slice(0, 100) } : {}), ...(body.creative_id ? { utm_content: String(body.creative_id).slice(0, 100) } : {}), ...(test ? { utm_term: 'test' } : {}) },
  });
  if (r.duplicate) return { received: true, duplicate: true };
  if (!test) afterIngest(r);
  db.prepare('UPDATE google_ads_hook SET last_lead_at = ? WHERE id = ?').run(iso(), hook.id);
  return { received: true };
}
