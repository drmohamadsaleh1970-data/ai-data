// Meta Lead Ads (Facebook / Instagram instant forms) without Zapier.
//
// Set up once (see docs/HOT_LEADS.md):
//   META_APP_SECRET   - the Meta app's secret: checks that webhooks really come from Meta
//                       (X-Hub-Signature-256) and encrypts stored Page tokens.
//   META_VERIFY_TOKEN - any long random text; typed into the Meta app's webhook settings.
// Then the owner connects each Facebook Page (Page ID + Page access token with
// leads_retrieval) and chooses where its leads go: the AI-DATA Hot pool or one account.
//
// Meta sends only the lead's id; the lead itself is read from the Graph API with the
// Page token. Every lead is deduplicated by its leadgen id.
import crypto from 'node:crypto';
import { getDb } from './db.js';
import { HttpError, iso, audit } from './util.js';
import { normalizePhone } from './crm.js';
import { ingest, afterIngest } from './hot.js';

const env = process.env;
const appSecret = () => env.META_APP_SECRET || '';
const verifyToken = () => env.META_VERIFY_TOKEN || '';
const graphBase = () => `${(env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, '')}/${env.META_GRAPH_VERSION || 'v21.0'}`;
export const metaConfigured = () => !!(appSecret() && verifyToken());

// --- Page tokens are stored encrypted -------------------------------------------------
const keyFor = () => crypto.createHash('sha256').update(`ai-data:meta-page-token:${appSecret()}`).digest();
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decrypt(stored) {
  const [iv, tag, enc] = String(stored).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', keyFor(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

function refreshSourceStatus() {
  const db = getDb();
  const pages = Number(db.prepare("SELECT COUNT(*) AS n FROM meta_page WHERE status = 'ACTIVE'").get().n);
  db.prepare("UPDATE hot_lead_source SET status = ? WHERE code = 'META_LEAD_ADS'").run(metaConfigured() && pages ? 'CONNECTED' : 'NOT_CONNECTED');
}

export function metaStatus() {
  const pages = getDb().prepare(`SELECT p.id, p.page_id, p.page_name, p.org_id, o.name AS org_name, p.campaign_id, k.name AS campaign_name, p.status, p.last_lead_at, p.last_error, p.created_at
    FROM meta_page p LEFT JOIN organization o ON o.id = p.org_id LEFT JOIN lead_campaign k ON k.id = p.campaign_id ORDER BY p.id`).all();
  return { app_secret_set: !!appSecret(), verify_token_set: !!verifyToken(), configured: metaConfigured(), webhook_path: '/api/webhooks/meta', pages };
}

export function connectPage({ actor, page_id, page_name, access_token, org_id, campaign_id }) {
  if (!metaConfigured()) throw new HttpError(409, 'META_NOT_CONFIGURED', 'Set META_APP_SECRET and META_VERIFY_TOKEN on the server first.');
  const db = getDb();
  const pid = String(page_id || '').trim();
  if (!/^\d{5,25}$/.test(pid)) throw new HttpError(400, 'INVALID_PAGE_ID', 'The Facebook Page ID is a number (Page → About → Page transparency).');
  const name = String(page_name || '').trim().slice(0, 120) || `Page ${pid}`;
  const token = String(access_token || '').trim();
  if (token.length < 20) throw new HttpError(400, 'TOKEN_REQUIRED', 'Paste the Page access token (with leads_retrieval permission).');
  const orgId = org_id ? Number(org_id) : null;
  if (orgId && !db.prepare('SELECT 1 FROM organization WHERE id = ?').get(orgId)) throw new HttpError(404, 'ORG_NOT_FOUND');
  let campaignId = null;
  if (campaign_id) {
    const c = db.prepare('SELECT id, org_id FROM lead_campaign WHERE id = ?').get(Number(campaign_id));
    if (!c || (c.org_id == null ? null : Number(c.org_id)) !== orgId) throw new HttpError(400, 'CAMPAIGN_DESTINATION_MISMATCH', 'Choose a campaign that sends leads to the same place.');
    campaignId = Number(c.id);
  }
  const ts = iso();
  const existing = db.prepare('SELECT id FROM meta_page WHERE page_id = ?').get(pid);
  if (existing) {
    db.prepare("UPDATE meta_page SET page_name = ?, org_id = ?, campaign_id = ?, token_enc = ?, status = 'ACTIVE', last_error = NULL WHERE id = ?").run(name, orgId, campaignId, encrypt(token), existing.id);
  } else {
    db.prepare("INSERT INTO meta_page (page_id, page_name, org_id, campaign_id, token_enc, status, created_by, created_at) VALUES (?,?,?,?,?,'ACTIVE',?,?)").run(pid, name, orgId, campaignId, encrypt(token), actor.id, ts);
  }
  audit({ actor: actor.id, org: orgId, action: 'META_PAGE_CONNECTED', target: `meta_page:${pid}`, meta: { page_name: name, campaign_id: campaignId } });
  refreshSourceStatus();
  return metaStatus();
}

export function removePage({ actor, id }) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM meta_page WHERE id = ?').get(Number(id));
  if (!p) throw new HttpError(404, 'NOT_FOUND');
  db.prepare('DELETE FROM meta_page WHERE id = ?').run(p.id);
  audit({ actor: actor.id, org: p.org_id, action: 'META_PAGE_REMOVED', target: `meta_page:${p.page_id}` });
  refreshSourceStatus();
  return metaStatus();
}

// GET /api/webhooks/meta - Meta's one-time subscription check.
export function verifySubscription(query) {
  if (!metaConfigured()) throw new HttpError(404, 'NOT_FOUND');
  const a = Buffer.from(String(query['hub.verify_token'] || ''));
  const b = Buffer.from(verifyToken());
  if (query['hub.mode'] !== 'subscribe' || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'VERIFY_TOKEN_MISMATCH');
  return String(query['hub.challenge'] || '');
}

function signatureValid(rawBody, header) {
  if (!rawBody || !header || !String(header).startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', appSecret()).update(rawBody).digest('hex')}`);
  const got = Buffer.from(String(header));
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

// Turns Meta's field_data into our lead fields. Standard keys first; custom questions
// about area, type, bedrooms and budget are recognised by name; anything else goes into
// the message so the agent sees it.
export function mapFields(fieldData = []) {
  const v = Object.fromEntries(fieldData.map((f) => [String(f.name || '').toLowerCase(), Array.isArray(f.values) ? f.values.join(', ') : String(f.values ?? '')]));
  const pick = (...keys) => keys.map((k) => v[k]).find((x) => x && String(x).trim());
  const out = {
    full_name: pick('full_name', 'name') || [pick('first_name'), pick('last_name')].filter(Boolean).join(' '),
    phone: pick('phone_number', 'phone', 'mobile_number', 'whatsapp_number'),
    email: pick('email', 'work_email'),
  };
  const used = new Set(['full_name', 'name', 'first_name', 'last_name', 'phone_number', 'phone', 'mobile_number', 'whatsapp_number', 'email', 'work_email']);
  const extra = [];
  for (const [k, val] of Object.entries(v)) {
    if (used.has(k) || !val) continue;
    if (!out.area && /area|location|community|district|neighbo/.test(k)) out.area = val.slice(0, 80);
    else if (!out.property_type && /property|unit_type|type_of/.test(k)) out.property_type = val.slice(0, 40);
    else if (out.bedrooms == null && /bed/.test(k)) { const n = parseInt(val, 10); out.bedrooms = Number.isFinite(n) ? n : null; if (!Number.isFinite(n)) extra.push(`${k}: ${val}`); }
    else if (out.budget_max_aed == null && /budget|price/.test(k)) { const digits = val.replace(/[^\d]/g, ''); out.budget_max_aed = digits ? Number(digits) : null; extra.push(`${k}: ${val}`); }
    else extra.push(`${k.replace(/_/g, ' ')}: ${val}`);
  }
  out.message = extra.join('\n').slice(0, 1000);
  return out;
}

async function fetchLead(leadgenId, token) {
  const fields = 'field_data,created_time,ad_id,ad_name,adset_name,campaign_name,form_id,platform';
  const res = await fetch(`${graphBase()}/${encodeURIComponent(leadgenId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Graph API ${res.status}`);
  return data;
}

// POST /api/webhooks/meta
export async function handleWebhook({ headers, rawBody, body }) {
  if (!metaConfigured()) throw new HttpError(404, 'NOT_FOUND');
  if (!signatureValid(rawBody, headers['x-hub-signature-256'])) throw new HttpError(401, 'INVALID_SIGNATURE');
  if (body?.object !== 'page') return { processed: 0, duplicates: 0, ignored: 0 };
  const db = getDb();
  const result = { processed: 0, duplicates: 0, ignored: 0 };
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen' || !change.value?.leadgen_id) continue;
      const { leadgen_id: leadgenId, page_id: pageId } = change.value;
      const page = db.prepare("SELECT * FROM meta_page WHERE page_id = ? AND status = 'ACTIVE'").get(String(pageId || entry.id || ''));
      if (!page) { result.ignored++; continue; }
      if (db.prepare("SELECT 1 FROM webhook_receipt WHERE source_code = 'META_LEAD_ADS' AND provider_event_id = ?").get(String(leadgenId))) { result.duplicates++; continue; }
      let lead;
      try {
        lead = await fetchLead(leadgenId, decrypt(page.token_enc));
      } catch (err) {
        db.prepare('UPDATE meta_page SET last_error = ? WHERE id = ?').run(`${iso()} ${String(err.message).slice(0, 200)}`, page.id);
        // Not acknowledged: Meta retries later, and the leadgen id prevents duplicates.
        throw new HttpError(502, 'META_LEAD_FETCH_FAILED', 'Could not read the lead from Meta; Meta will retry.');
      }
      const f = mapFields(lead.field_data);
      const phone = normalizePhone(f.phone);
      const email = f.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) ? String(f.email).toLowerCase() : null;
      if (!f.full_name || (!phone && !email)) { result.ignored++; continue; }
      const createdAt = lead.created_time ? new Date(lead.created_time) : null;
      const r = ingest({
        orgId: page.org_id, sourceCode: 'META_LEAD_ADS', eventKey: String(leadgenId),
        fullName: f.full_name.slice(0, 120), email, phone, language: null,
        interest: { area: f.area, property_type: f.property_type, bedrooms: f.bedrooms, budget_max_aed: f.budget_max_aed, message: f.message },
        // Meta instant forms require the advertiser's privacy policy; submitting the form is
        // the request to be contacted. Marketing consent is never assumed.
        consent: { contact: true, marketing: false, notice_version: `meta-form-${lead.form_id || 'unknown'}`, captured_at: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : iso(), channel: 'META_LEAD_ADS', page: page.page_name, form_id: lead.form_id || null, ad_id: lead.ad_id || null },
        detail: `META_LEAD_ADS:${page.page_name}`, campaignId: page.campaign_id ?? null,
        utm: { utm_source: lead.platform === 'ig' ? 'instagram' : 'facebook', utm_medium: 'lead_ads', ...(lead.campaign_name ? { utm_campaign: String(lead.campaign_name).slice(0, 100) } : {}), ...(lead.ad_name ? { utm_content: String(lead.ad_name).slice(0, 100) } : {}) },
      });
      if (r.duplicate) { result.duplicates++; continue; }
      afterIngest(r);
      db.prepare('UPDATE meta_page SET last_lead_at = ?, last_error = NULL WHERE id = ?').run(iso(), page.id);
      result.processed++;
    }
  }
  return result;
}
