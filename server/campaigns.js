// Lead generation campaigns. Each campaign is a hosted landing page (/c/<slug>) with its
// own website key, so every enquiry is attributed to the campaign (and to the ad or
// channel through utm_* parameters). org_id NULL = AI-DATA Hot pool (owner campaigns);
// otherwise leads go straight to that organization's CRM.
import qrcode from 'qrcode-generator';
import { getDb } from './db.js';
import { HttpError, iso, audit, randomToken } from './util.js';
import { createSiteKey } from './hot.js';

export const CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE', 'TIKTOK', 'LINKEDIN', 'EMAIL', 'SMS', 'QR_PRINT', 'WEBSITE', 'OTHER'];
const LANGS = ['en', 'ar', 'fr', 'ru', 'tr'];
const QUALIFIED = new Set(['QUALIFIED', 'INTERESTED', 'VIEWING_SCHEDULED', 'VIEWED', 'NEGOTIATION', 'BOOKING', 'CONTRACT', 'CLOSED_WON']);
const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

function slugFor(name) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 40).replace(/^-|-$/g, '') || 'campaign';
  return `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'x'}`;
}

function cleanFields(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) { out.name = text(body.name, 120); if (!out.name) throw new HttpError(400, 'NAME_REQUIRED', 'Give the campaign a name.'); }
  if (!partial || body.headline !== undefined) { out.headline = text(body.headline, 160) || out.name || null; if (!partial && !out.headline) throw new HttpError(400, 'HEADLINE_REQUIRED'); }
  if (!partial || body.channel !== undefined) { out.channel = String(body.channel || 'OTHER').toUpperCase(); if (!CHANNELS.includes(out.channel)) throw new HttpError(400, 'INVALID_CHANNEL'); }
  if (!partial || body.language !== undefined) { out.language = LANGS.includes(body.language) ? body.language : 'en'; }
  for (const [k, max] of [['description', 1200], ['area', 80], ['property_type', 40]]) if (!partial || body[k] !== undefined) out[k] = text(body[k], max);
  if (!partial || body.privacy_url !== undefined) {
    out.privacy_url = text(body.privacy_url, 300);
    if (out.privacy_url) { try { const u = new URL(out.privacy_url); if (!/^https?:$/.test(u.protocol)) throw new Error(); out.privacy_url = u.href; } catch { throw new HttpError(400, 'INVALID_PRIVACY_URL', 'Use a full address, e.g. https://www.ai-home.world/privacy'); } }
  }
  if (!partial || body.spend_aed !== undefined) {
    const v = body.spend_aed === '' || body.spend_aed == null ? 0 : Math.round(Number(body.spend_aed));
    if (!Number.isFinite(v) || v < 0 || v > 100_000_000) throw new HttpError(400, 'INVALID_SPEND');
    out.spend_aed = v;
  }
  if (partial && body.status !== undefined) { if (!['ACTIVE', 'PAUSED'].includes(body.status)) throw new HttpError(400, 'INVALID_STATUS'); out.status = body.status; }
  return out;
}

export function createCampaign({ actor, orgId, body }) {
  const db = getDb();
  if (orgId != null && !db.prepare('SELECT 1 FROM organization WHERE id = ?').get(Number(orgId))) throw new HttpError(404, 'ORG_NOT_FOUND');
  const f = cleanFields(body);
  const slug = slugFor(f.name);
  const key = createSiteKey({ actor, orgId: orgId ?? null, label: `Campaign: ${f.name}` }).key;
  const ts = iso();
  const id = Number(db.prepare(`INSERT INTO lead_campaign (org_id, name, slug, channel, headline, description, area, property_type, language, privacy_url, spend_aed, status, site_key, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?)`).run(orgId ?? null, f.name, slug, f.channel, f.headline, f.description, f.area, f.property_type, f.language, f.privacy_url, f.spend_aed, key, actor.id, ts, ts).lastInsertRowid);
  audit({ actor: actor.id, org: orgId ?? null, action: 'CAMPAIGN_CREATED', target: `campaign:${id}`, meta: { name: f.name, slug } });
  return getCampaign(id);
}

export function getCampaign(id) {
  return getDb().prepare('SELECT c.*, o.name AS org_name, o.kind AS org_kind FROM lead_campaign c LEFT JOIN organization o ON o.id = c.org_id WHERE c.id = ?').get(Number(id));
}

export function updateCampaign({ actor, id, orgId, owner = false, body }) {
  const db = getDb();
  const c = getCampaign(id);
  if (!c || (!owner && Number(c.org_id) !== Number(orgId))) throw new HttpError(404, 'NOT_FOUND');
  const f = cleanFields(body, { partial: true });
  if (!Object.keys(f).length) throw new HttpError(400, 'NOTHING_TO_CHANGE');
  for (const [k, v] of Object.entries(f)) db.prepare(`UPDATE lead_campaign SET ${k} = ?, updated_at = ? WHERE id = ?`).run(v, iso(), c.id);
  audit({ actor: actor.id, org: c.org_id, action: 'CAMPAIGN_UPDATED', target: `campaign:${c.id}`, meta: f });
  return getCampaign(c.id);
}

// What the public landing page needs. Paused campaigns still answer, so the page can say so.
export function publicCampaign(slug) {
  const c = getDb().prepare('SELECT c.*, o.name AS org_name FROM lead_campaign c LEFT JOIN organization o ON o.id = c.org_id WHERE c.slug = ?').get(String(slug || '').slice(0, 80));
  if (!c) throw new HttpError(404, 'NOT_FOUND');
  return { slug: c.slug, name: c.name, headline: c.headline, description: c.description, area: c.area, property_type: c.property_type, language: c.language,
    privacy_url: c.privacy_url, brand: c.org_name || 'AI-DATA', active: c.status === 'ACTIVE', site_key: c.status === 'ACTIVE' ? c.site_key : null };
}

// QR code for printed material and screens; points to the landing page tagged as QR.
export function qrSvg(url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const m = 4;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + m},${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// Campaigns with their results. orgId = one organization's campaigns; null = all (owner).
export function listCampaigns({ orgId = null } = {}) {
  const db = getDb();
  const campaigns = orgId == null
    ? db.prepare('SELECT c.*, o.name AS org_name, o.kind AS org_kind FROM lead_campaign c LEFT JOIN organization o ON o.id = c.org_id ORDER BY c.id DESC').all()
    : db.prepare('SELECT c.*, o.name AS org_name, o.kind AS org_kind FROM lead_campaign c LEFT JOIN organization o ON o.id = c.org_id WHERE c.org_id = ? ORDER BY c.id DESC').all(Number(orgId));
  if (!campaigns.length) return { campaigns: [], totals: { received: 0, won: 0, spend_aed: 0 } };
  const ids = campaigns.map((c) => Number(c.id));
  const marks = ids.map(() => '?').join(',');
  const pool = db.prepare(`SELECT campaign_id, allocated_org_id, utm_json, received_at FROM hot_lead_pool WHERE campaign_id IN (${marks})`).all(...ids);
  const leads = db.prepare(`SELECT campaign_id, org_id, stage, first_contacted_at, deal_value_aed, utm_json, created_at FROM crm_lead WHERE campaign_id IN (${marks})`).all(...ids);
  const rows = campaigns.map((c) => {
    const cid = Number(c.id);
    const p = pool.filter((x) => Number(x.campaign_id) === cid);
    // An organization only ever sees its own CRM rows for its own campaigns.
    const l = leads.filter((x) => Number(x.campaign_id) === cid && (c.org_id == null || Number(x.org_id) === Number(c.org_id)));
    const fromPool = c.org_id == null;
    const received = fromPool ? p.length : l.length;
    const sourceRows = fromPool ? p : l;
    const by_source = {};
    for (const x of sourceRows) { let s = 'direct'; try { s = JSON.parse(x.utm_json || 'null')?.utm_source || 'direct'; } catch { /* keep direct */ } by_source[s] = (by_source[s] || 0) + 1; }
    const won = l.filter((x) => x.stage === 'CLOSED_WON');
    const last = [...p.map((x) => x.received_at), ...l.map((x) => x.created_at)].sort().pop() || null;
    return {
      id: cid, org_id: c.org_id, org_name: c.org_name, org_kind: c.org_kind, name: c.name, slug: c.slug, channel: c.channel, headline: c.headline, description: c.description,
      area: c.area, property_type: c.property_type, language: c.language, privacy_url: c.privacy_url, status: c.status, spend_aed: Number(c.spend_aed || 0), created_at: c.created_at,
      destination: fromPool ? 'AIHOME_HOT_POOL' : 'ORG_CRM',
      received, waiting_in_pool: fromPool ? p.filter((x) => !x.allocated_org_id).length : 0, in_crm: l.length,
      contacted: l.filter((x) => x.first_contacted_at).length, qualified: l.filter((x) => QUALIFIED.has(x.stage)).length, won: won.length,
      won_value_aed: won.reduce((s, x) => s + Number(x.deal_value_aed || 0), 0),
      cost_per_lead_aed: received && c.spend_aed ? Math.round(Number(c.spend_aed) / received) : null,
      cost_per_won_aed: won.length && c.spend_aed ? Math.round(Number(c.spend_aed) / won.length) : null,
      by_source, last_lead_at: last,
    };
  });
  const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  return { campaigns: rows, totals: { received: sum('received'), contacted: sum('contacted'), qualified: sum('qualified'), won: sum('won'), spend_aed: sum('spend_aed'), won_value_aed: sum('won_value_aed') } };
}
