import { getDb, tx } from './db.js';
import { HttpError, iso, now, audit, randomToken, flag } from './util.js';
import { normalizePhone } from './crm.js';
import { alertNewLead, alertNewPoolLead, alertSearch } from './alerts.js';

// Alerts must never stop a lead from being stored.
const safely = (fn) => { try { fn(); } catch (err) { console.error('[alerts]', err); } };

// Hot Leads: a separate commercial product with its own ledger. Nothing here reads or
// writes Cold quota tables.
export function sources() {
  return getDb().prepare('SELECT * FROM hot_lead_source ORDER BY CASE status WHEN \'CONNECTED\' THEN 0 ELSE 1 END, name').all();
}

export function pricing() {
  const rule = getDb().prepare('SELECT * FROM hot_lead_pricing_rule WHERE approved = 1 ORDER BY id DESC LIMIT 1').get();
  return rule
    ? { configured: true, rule }
    : { configured: false, status: 'OWNER_CONFIGURATION_REQUIRED', message: 'Hot Leads pricing has not been configured by the platform owner. Checkout is not yet available.' };
}

export function configurePricing({ actor, model, priceCents, currency = 'AED', exclusive = true }) {
  if (!['PER_LEAD', 'PREPAID_CREDITS', 'MONTHLY_ALLOCATION', 'CAMPAIGN_BUDGET'].includes(model)) throw new HttpError(400, 'INVALID_MODEL');
  if (!Number.isInteger(priceCents) || priceCents <= 0) throw new HttpError(400, 'INVALID_PRICE');
  const id = Number(getDb().prepare('INSERT INTO hot_lead_pricing_rule (model, price_cents, currency, exclusive, approved, configured_by, created_at) VALUES (?,?,?,?,1,?,?)')
    .run(model, priceCents, currency, exclusive ? 1 : 0, actor.id, iso()).lastInsertRowid);
  audit({ actor: actor.id, action: 'HOT_PRICING_CONFIGURED', target: `rule:${id}`, meta: { model, priceCents, currency, exclusive } });
  return pricing();
}

// Owner grants Hot credits after a Hot-specific payment is confirmed (separate ledger).
export function grantEntitlement({ actor, orgId, credits }) {
  const p = pricing();
  if (!p.configured) throw new HttpError(409, 'OWNER_CONFIGURATION_REQUIRED');
  if (!Number.isInteger(credits) || credits <= 0) throw new HttpError(400, 'INVALID_CREDITS');
  const id = Number(getDb().prepare("INSERT INTO hot_lead_entitlement (org_id, pricing_rule_id, credits_total, status, granted_by, created_at) VALUES (?,?,?,'ACTIVE',?,?)")
    .run(Number(orgId), p.rule.id, credits, actor.id, iso()).lastInsertRowid);
  audit({ actor: actor.id, org: Number(orgId), action: 'HOT_ENTITLEMENT_GRANTED', target: `hot_ent:${id}`, meta: { credits } });
  return { id };
}

// Website keys route public form submissions: a platform key (no org) feeds the AI-DATA
// Hot pool; an agency key delivers straight into that agency's CRM. Keys sit in the page
// source, so they are not secrets; an optional allowed origin limits which site's
// browsers may use one.
export function siteKeys() {
  return getDb().prepare(`SELECT s.key, s.label, s.org_id, s.allowed_origin, o.name AS org_name FROM site_key s
    LEFT JOIN organization o ON o.id = s.org_id ORDER BY s.org_id IS NOT NULL, o.name, s.label`).all();
}

export function createSiteKey({ actor, orgId, label, allowedOrigin }) {
  const db = getDb();
  const name = String(label || '').trim().slice(0, 120);
  if (!name) throw new HttpError(400, 'LABEL_REQUIRED', 'Give the key a name, e.g. the website address.');
  let origin = null;
  if (allowedOrigin) {
    try { origin = new URL(String(allowedOrigin)).origin; } catch { throw new HttpError(400, 'INVALID_ORIGIN', 'Use the full website address, e.g. https://www.ai-home.world'); }
  }
  const org = orgId ? db.prepare('SELECT id FROM organization WHERE id = ?').get(Number(orgId)) : null;
  if (orgId && !org) throw new HttpError(404, 'ORG_NOT_FOUND');
  const key = `sk_${randomToken(12)}`;
  db.prepare('INSERT INTO site_key (key, org_id, label, allowed_origin) VALUES (?,?,?,?)').run(key, org?.id ?? null, name, origin);
  audit({ actor: actor.id, org: org?.id, action: 'SITE_KEY_CREATED', target: `site_key:${key}`, meta: { label: name, allowed_origin: origin } });
  return { key, label: name, org_id: org?.id ?? null, allowed_origin: origin };
}

export function revokeSiteKey({ actor, key }) {
  const db = getDb();
  const site = db.prepare('SELECT * FROM site_key WHERE key = ?').get(String(key));
  if (!site) throw new HttpError(404, 'NOT_FOUND');
  db.prepare('DELETE FROM site_key WHERE key = ?').run(site.key);
  audit({ actor: actor.id, org: site.org_id, action: 'SITE_KEY_REVOKED', target: `site_key:${site.key}` });
  return { revoked: true };
}

// Form tools (Zapier, Make, plain HTML) often send booleans as text.
const yes = (v) => v === true || ['true', 'yes', '1', 'on'].includes(String(v ?? '').trim().toLowerCase());

// Public first-party inquiry intake, routed by the site key (see siteKeys above).
const rate = new Map();
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
export function cleanUtm(src = {}) {
  const u = {};
  for (const k of UTM_KEYS) if (src[k] != null && String(src[k]).trim()) u[k] = String(src[k]).trim().slice(0, 100);
  return Object.keys(u).length ? u : null;
}

export function intakeInquiry(args) {
  const result = intakeInquiryTx(args);
  afterIngest(result);
  return result;
}

// A new pool lead goes straight to the next customer with Hot credits when the owner has
// turned automatic distribution on. The visitor's answer never names that customer.
export function afterIngest(result) {
  if (result?.destination === 'AGENCY_CRM') safely(() => alertNewLead(result.lead_id));
  if (result?.destination === 'AIHOME_HOT_POOL') {
    safely(() => alertNewPoolLead(result.pool_id));
    if (flag(AUTO_FLAG)) autoAllocate(result.pool_id);
  }
}

function intakeInquiryTx({ siteKey, body, ip, origin }) {
  const db = getDb();
  const site = db.prepare('SELECT * FROM site_key WHERE key = ?').get(String(siteKey || ''));
  if (!site) throw new HttpError(401, 'INVALID_SITE_KEY');
  if (site.allowed_origin && origin && origin !== site.allowed_origin) throw new HttpError(403, 'ORIGIN_NOT_ALLOWED');
  const bucket = `${ip}:${Math.floor(now().getTime() / 60_000)}`;
  const hits = (rate.get(bucket) || 0) + 1;
  rate.set(bucket, hits);
  if (hits > 10) throw new HttpError(429, 'RATE_LIMITED');
  if (body.website) throw new HttpError(400, 'REJECTED'); // honeypot
  const fullName = String(body.full_name || '').trim().slice(0, 120);
  const phone = normalizePhone(body.phone);
  const email = body.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email) ? String(body.email).toLowerCase() : null;
  if (!fullName || (!phone && !email)) throw new HttpError(400, 'NAME_AND_CONTACT_REQUIRED');
  if (!yes(body.consent_contact)) throw new HttpError(400, 'CONSENT_REQUIRED', 'The privacy notice must be accepted.');
  // Campaign: named by its page (body.campaign) or implied by the campaign's own key.
  let campaign = null;
  if (body.campaign) {
    campaign = db.prepare('SELECT * FROM lead_campaign WHERE slug = ?').get(String(body.campaign).slice(0, 80));
    if (!campaign || campaign.site_key !== site.key) throw new HttpError(400, 'UNKNOWN_CAMPAIGN');
  } else {
    campaign = db.prepare('SELECT * FROM lead_campaign WHERE site_key = ?').get(site.key) || null;
  }
  if (campaign && campaign.status !== 'ACTIVE') throw new HttpError(410, 'CAMPAIGN_PAUSED', 'This campaign is not taking enquiries at the moment.');
  const eventId = String(body.client_event_id || `${phone || email}:${Math.floor(now().getTime() / 600_000)}`).slice(0, 120);
  const consent = { contact: true, marketing: yes(body.consent_marketing), notice_version: String(body.notice_version || 'v1'), captured_at: iso(), channel: campaign ? 'CAMPAIGN_PAGE' : 'WEB_FORM', site: site.label, ...(campaign ? { campaign: campaign.slug } : {}) };
  const interest = { area: body.area, property_type: body.property_type, bedrooms: body.bedrooms, budget_max_aed: body.budget_max_aed, message: String(body.message || '').slice(0, 1000) };
  return ingest({
    orgId: site.org_id, sourceCode: site.org_id ? 'AGENCY_WEB_FORM' : 'AIHOME_WEB_FORM', eventKey: `${site.key}:${eventId}`,
    fullName, email, phone, language: body.language, interest, consent,
    detail: campaign ? `CAMPAIGN:${campaign.slug}` : `AGENCY_WEB_FORM:${site.label}`,
    campaignId: campaign?.id ?? null, utm: cleanUtm(body),
  });
}

// One way in for every Hot lead (web form, campaign page, Meta Lead Ads): deduplicated by
// source + event key; no organization = AI-DATA Hot pool, otherwise straight to that CRM.
export function ingest({ orgId, sourceCode, eventKey, fullName, email, phone, language, interest, consent, detail, campaignId = null, utm = null }) {
  const ts = iso();
  return tx((conn) => {
    const seen = conn.prepare('SELECT id FROM webhook_receipt WHERE source_code = ? AND provider_event_id = ?').get(sourceCode, eventKey);
    if (seen) return { duplicate: true };
    conn.prepare('INSERT INTO webhook_receipt (source_code, provider_event_id, received_at, processed_at, outcome) VALUES (?,?,?,?,?)')
      .run(sourceCode, eventKey, ts, ts, 'ACCEPTED');
    conn.prepare('UPDATE hot_lead_source SET last_event_at = ? WHERE code = ?').run(ts, sourceCode);
    if (!orgId) {
      const id = Number(conn.prepare(`INSERT INTO hot_lead_pool (source_code, provider_event_id, full_name, email, phone, preferred_language, interest_json, consent_json, received_at, campaign_id, utm_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(sourceCode, eventKey, fullName, email, phone, language ?? null, JSON.stringify(interest), JSON.stringify(consent), ts, campaignId, utm ? JSON.stringify(utm) : null).lastInsertRowid);
      return { accepted: true, destination: 'AIHOME_HOT_POOL', pool_id: id };
    }
    const leadId = createHotLead(conn, { orgId: Number(orgId), fullName, email, phone, language, interest, consent, detail, campaignId, utm });
    return { accepted: true, destination: 'AGENCY_CRM', lead_id: leadId };
  });
}

function createHotLead(conn, { orgId, fullName, email, phone, language, interest, consent, detail, campaignId = null, utm = null }) {
  const ts = iso();
  const org = conn.prepare('SELECT * FROM organization WHERE id = ?').get(orgId);
  // Round-robin across agents; falls back to the organization owner.
  const agents = conn.prepare("SELECT user_id FROM membership WHERE org_id = ? AND role='AGENT' AND status='ACTIVE' ORDER BY user_id").all(orgId);
  const n = conn.prepare("SELECT COUNT(*) AS n FROM crm_lead WHERE org_id = ? AND source_type='HOT'").get(orgId).n;
  const assignee = agents.length ? agents[Number(n) % agents.length].user_id : org.owner_user_id;
  const campaignName = campaignId ? conn.prepare('SELECT name FROM lead_campaign WHERE id = ?').get(campaignId)?.name ?? null : null;
  const cid = Number(conn.prepare(`INSERT INTO crm_contact (org_id, full_name, email, phone, preferred_language, source_type, marketing_permission, created_at, updated_at)
    VALUES (?,?,?,?,?,'HOT',?,?,?)`).run(orgId, fullName, email, phone, language ?? null, consent.marketing ? 'GRANTED' : 'UNKNOWN', ts, ts).lastInsertRowid);
  const due = new Date(Date.parse(ts) + org.first_contact_sla_minutes_hot * 60_000).toISOString();
  const leadId = Number(conn.prepare(`INSERT INTO crm_lead (org_id, contact_id, source_type, source_detail, provenance_note, stage, assigned_user_id, priority, interest_json, consent_json, first_contact_due, created_at, updated_at, campaign_id, utm_json, campaign_tag)
    VALUES (?,?,'HOT',?,?,'NEW',?,'HIGH',?,?,?,?,?,?,?,?)`).run(orgId, cid, detail, 'Current inquiry submitted by the person with recorded consent', assignee, JSON.stringify(interest), JSON.stringify(consent), due, ts, ts,
    campaignId, utm ? JSON.stringify(utm) : null, campaignName).lastInsertRowid);
  conn.prepare('INSERT INTO follow_up_task (org_id, lead_id, assignee_id, title, due_at, created_at) VALUES (?,?,?,?,?,?)').run(orgId, leadId, assignee, 'Respond to new inquiry', due, ts);
  conn.prepare('INSERT INTO notification (user_id, org_id, type, body, link, created_at) VALUES (?,?,?,?,?,?)').run(assignee, orgId, 'HOT_LEAD', `New inquiry: ${fullName} — respond within ${org.first_contact_sla_minutes_hot} min`, `#/crm/lead/${leadId}`, ts);
  return leadId;
}

export function pool() {
  return getDb().prepare('SELECT p.id, p.source_code, p.full_name, p.interest_json, p.consent_json, p.received_at, p.allocated_org_id, p.allocated_at, p.allocation_method, o.name AS allocated_org_name FROM hot_lead_pool p LEFT JOIN organization o ON o.id = p.allocated_org_id ORDER BY p.id DESC LIMIT 200').all();
}

// Exclusive allocation of an AI-DATA pool lead to one paying agency, billed against its
// Hot entitlement. A unique pool_id in the ledger prevents double billing.
export function allocate({ actor, poolId, orgId }) {
  const p = pricing();
  if (!p.configured) throw new HttpError(409, 'OWNER_CONFIGURATION_REQUIRED');
  const r = tx((conn) => allocateIn(conn, { actorId: actor.id, poolId, orgId, rule: p.rule, method: 'MANUAL' }));
  safely(() => alertNewLead(r.crm_lead_id));
  return r;
}

function allocateIn(conn, { actorId, poolId, orgId, rule, method }) {
  const lead = conn.prepare('SELECT * FROM hot_lead_pool WHERE id = ?').get(Number(poolId));
  if (!lead) throw new HttpError(404, 'NOT_FOUND');
  if (lead.allocated_org_id) throw new HttpError(409, 'ALREADY_ALLOCATED');
  const src = conn.prepare('SELECT * FROM hot_lead_source WHERE code = ?').get(lead.source_code);
  if (src?.isolation_required) throw new HttpError(403, 'SOURCE_POLICY_FORBIDS_REALLOCATION');
  const ent = conn.prepare("SELECT * FROM hot_lead_entitlement WHERE org_id = ? AND status='ACTIVE' AND credits_used < credits_total ORDER BY id LIMIT 1").get(Number(orgId));
  if (!ent) throw new HttpError(402, 'NO_HOT_CREDITS');
  const consent = JSON.parse(lead.consent_json);
  const leadId = createHotLead(conn, { orgId: Number(orgId), fullName: lead.full_name, email: lead.email, phone: lead.phone, language: lead.preferred_language, interest: JSON.parse(lead.interest_json), consent, detail: 'AIHOME_HOT_ALLOCATION', campaignId: lead.campaign_id ?? null, utm: lead.utm_json ? JSON.parse(lead.utm_json) : null });
  conn.prepare('UPDATE hot_lead_pool SET allocated_org_id = ?, allocated_at = ?, allocation_method = ? WHERE id = ?').run(Number(orgId), iso(), method, lead.id);
  conn.prepare('UPDATE hot_lead_entitlement SET credits_used = credits_used + 1 WHERE id = ?').run(ent.id);
  conn.prepare('INSERT INTO hot_lead_billing_ledger (org_id, pool_id, crm_lead_id, entitlement_id, amount_cents, currency, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(Number(orgId), lead.id, leadId, ent.id, rule.price_cents, rule.currency, iso());
  conn.prepare('INSERT INTO audit_log (at, actor_user_id, org_id, action, target) VALUES (?,?,?,?,?)')
    .run(iso(), actorId ?? null, Number(orgId), method === 'AUTO' ? 'HOT_LEAD_AUTO_ALLOCATED' : 'HOT_LEAD_ALLOCATED', `pool:${lead.id}`);
  return { crm_lead_id: leadId, org_id: Number(orgId) };
}

// --- Automatic distribution -------------------------------------------------------
// Customers "in the queue" are organizations with an active Hot entitlement that still
// has credits. Each lead goes to the one served least recently (never served first),
// so leads are shared in turn. Exclusive: one lead, one customer, one credit.
export const AUTO_FLAG = 'HOT_AUTO_DISTRIBUTE';

export function distributionQueue(conn = getDb()) {
  const rows = conn.prepare(`SELECT e.org_id, o.name, o.kind, SUM(e.credits_total - e.credits_used) AS credits_left
    FROM hot_lead_entitlement e JOIN organization o ON o.id = e.org_id
    WHERE e.status = 'ACTIVE' AND e.credits_used < e.credits_total GROUP BY e.org_id, o.name, o.kind`).all();
  const last = new Map(conn.prepare('SELECT org_id, MAX(created_at) AS at FROM hot_lead_billing_ledger GROUP BY org_id').all().map((r) => [Number(r.org_id), r.at]));
  return rows.map((r) => ({ org_id: Number(r.org_id), name: r.name, kind: r.kind, credits_left: Number(r.credits_left), last_lead_at: last.get(Number(r.org_id)) || null }))
    .sort((a, b) => ((a.last_lead_at || '') < (b.last_lead_at || '') ? -1 : (a.last_lead_at || '') > (b.last_lead_at || '') ? 1 : a.org_id - b.org_id));
}

// Gives one waiting pool lead to the next customer in the queue. Returns the result, or
// null when it stays in the pool (no pricing, no customer with credits, or source policy).
export function autoAllocate(poolId, actorId = null) {
  const p = pricing();
  if (!p.configured) return null;
  try {
    const r = tx((conn) => {
      const next = distributionQueue(conn)[0];
      if (!next) return null;
      return allocateIn(conn, { actorId, poolId, orgId: next.org_id, rule: p.rule, method: 'AUTO' });
    });
    if (r) safely(() => alertNewLead(r.crm_lead_id));
    return r;
  } catch (e) {
    if (e instanceof HttpError) return null; // stays in the pool for the owner
    throw e;
  }
}

// Owner button: share every waiting pool lead (oldest first) until credits run out.
export function distributeWaiting({ actor }) {
  const p = pricing();
  if (!p.configured) throw new HttpError(409, 'OWNER_CONFIGURATION_REQUIRED');
  const waiting = getDb().prepare('SELECT id FROM hot_lead_pool WHERE allocated_org_id IS NULL ORDER BY received_at, id').all();
  const given = [];
  for (const w of waiting) {
    const r = autoAllocate(w.id, actor.id);
    if (r) given.push(r);
    else if (!distributionQueue().length) break;
  }
  audit({ actor: actor.id, action: 'HOT_POOL_DISTRIBUTED', meta: { allocated: given.length, waiting: waiting.length } });
  return { allocated: given.length, still_waiting: waiting.length - given.length, by_org: given.reduce((m, g) => ((m[g.org_id] = (m[g.org_id] || 0) + 1), m), {}) };
}

export function orgHotView(orgId) {
  const db = getDb();
  return {
    pricing: pricing(),
    entitlements: db.prepare('SELECT id, credits_total, credits_used, status, created_at FROM hot_lead_entitlement WHERE org_id = ? ORDER BY id DESC').all(orgId),
    ledger: db.prepare('SELECT id, crm_lead_id, amount_cents, currency, created_at FROM hot_lead_billing_ledger WHERE org_id = ? ORDER BY id DESC LIMIT 100').all(orgId),
    recent: db.prepare(`SELECT l.id, c.full_name, l.source_detail, l.stage, l.created_at, l.first_contact_due, l.first_contacted_at FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id
      WHERE l.org_id = ? AND l.source_type = 'HOT' ORDER BY l.id DESC LIMIT 50`).all(orgId),
    site_keys: db.prepare('SELECT key, label FROM site_key WHERE org_id = ?').all(orgId),
    sources: sources(),
  };
}

// Anonymous first-party search analytics: no session id, IP, or identity is stored.
export function recordSearchEvent(body) {
  const allowed = ['search_performed', 'filters_changed', 'property_viewed', 'project_viewed', 'saved_search_created', 'calculator_used'];
  if (!allowed.includes(body.event_type)) throw new HttpError(400, 'INVALID_EVENT');
  if (body.consent_analytics !== true) return { stored: false, reason: 'NO_ANALYTICS_CONSENT' };
  const clean = (v) => (v == null ? null : String(v).replace(/[^\p{L}\p{N} \-]/gu, '').slice(0, 60));
  const bedrooms = body.bedrooms === '' || body.bedrooms == null ? null : Number(body.bedrooms);
  const budget = body.budget_max_aed === '' || body.budget_max_aed == null ? null : Number(body.budget_max_aed);
  // Site names keep their dots (ai-home.world); other fields keep letters, digits, spaces, hyphens.
  const site = body.site == null ? '' : String(body.site).replace(/[^\p{L}\p{N} .\-]/gu, '').slice(0, 60);
  const ev = { site: site || 'ai-home.world', event_type: body.event_type, city: clean(body.city), area: clean(body.area), property_type: clean(body.property_type),
    bedrooms: Number.isInteger(bedrooms) && bedrooms >= 0 && bedrooms <= 20 ? bedrooms : null, budget_max_aed: Number.isFinite(budget) && budget > 0 ? Math.round(budget) : null, purpose: clean(body.purpose) };
  getDb().prepare('INSERT INTO anonymous_search_event (site, event_type, city, area, property_type, bedrooms, budget_max_aed, purpose, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(ev.site, ev.event_type, ev.city, ev.area, ev.property_type, ev.bedrooms, ev.budget_max_aed, ev.purpose, iso());
  if (['search_performed', 'filters_changed', 'saved_search_created'].includes(ev.event_type)) safely(() => alertSearch(ev));
  return { stored: true, identified: false };
}
