// Lead alerts: "tell me as soon as a lead like this arrives".
// A rule is area / property type / bedrooms / budget range. When a new Hot lead matches,
// the rule's owner gets a notification within seconds and the lead is starred on Live leads.
//   - members of an organization: Hot leads of that organization (agents: only leads
//     assigned to them);
//   - platform owner: leads entering the AI-DATA Hot pool and Hot leads of every account,
//     and optionally anonymous ai-home.world searches ("someone is searching this now";
//     at most one search notification per rule every 10 minutes).
import { getDb } from './db.js';
import { HttpError, iso, now, notify, audit } from './util.js';
import { hasPerm } from './auth.js';

const TYPES = ['Apartment', 'Villa', 'Townhouse', 'Penthouse', 'Plot', 'Office'];
const SEARCH_THROTTLE_MS = 10 * 60_000;
const int = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);

export function describe(c) {
  const beds = c.bedrooms == null || c.bedrooms === '' ? null : Number(c.bedrooms) === 0 ? 'studio' : `${c.bedrooms}BR`;
  const budget = c.budget_min_aed && c.budget_max_aed ? `AED ${Number(c.budget_min_aed).toLocaleString('en')}–${Number(c.budget_max_aed).toLocaleString('en')}`
    : c.budget_max_aed ? `up to AED ${Number(c.budget_max_aed).toLocaleString('en')}` : c.budget_min_aed ? `from AED ${Number(c.budget_min_aed).toLocaleString('en')}` : null;
  return [beds, c.property_type, c.area, budget].filter(Boolean).join(' · ') || 'any Hot lead';
}

// Does a lead or search (area, property_type, bedrooms, budget_max_aed) fit the rule?
export function matches(rule, x) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  if (rule.area) {
    const a = norm(rule.area), b = norm(x.area);
    if (!b || !(b.includes(a) || a.includes(b))) return false;
  }
  if (rule.property_type && norm(rule.property_type) !== norm(x.property_type)) return false;
  if (rule.bedrooms != null) {
    const beds = x.bedrooms === '' || x.bedrooms == null ? null : Number(x.bedrooms);
    if (beds == null || Number.isNaN(beds) || beds !== Number(rule.bedrooms)) return false;
  }
  if (rule.budget_min_aed != null || rule.budget_max_aed != null) {
    const b = x.budget_max_aed == null || x.budget_max_aed === '' ? null : Number(x.budget_max_aed);
    if (b == null || Number.isNaN(b)) return false;
    if (rule.budget_min_aed != null && b < Number(rule.budget_min_aed)) return false;
    if (rule.budget_max_aed != null && b > Number(rule.budget_max_aed)) return false;
  }
  return true;
}

function clean(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  const area = String(body.area || '').trim().slice(0, 80) || null;
  const type = body.property_type ? TYPES.find((t) => t.toLowerCase() === String(body.property_type).toLowerCase()) : null;
  if (body.property_type && !type) throw new HttpError(400, 'INVALID_PROPERTY_TYPE');
  const bedrooms = int(body.bedrooms);
  const min = int(body.budget_min_aed), max = int(body.budget_max_aed);
  if ([bedrooms, min, max].some((v) => Number.isNaN(v)) || (bedrooms != null && (bedrooms < 0 || bedrooms > 10))) throw new HttpError(400, 'INVALID_NUMBER');
  if (min != null && max != null && min > max) throw new HttpError(400, 'BUDGET_RANGE_INVERTED', 'The minimum budget is above the maximum.');
  const rule = { area, property_type: type || null, bedrooms, budget_min_aed: min, budget_max_aed: max };
  return { ...rule, name: name || describe(rule) };
}

// Owner alerts have org_id NULL; members' alerts belong to their active organization.
export function listAlerts(user, orgId) {
  const rows = getDb().prepare(`SELECT * FROM lead_alert WHERE user_id = ? AND ${orgId == null ? 'org_id IS NULL' : 'org_id = ?'} ORDER BY id DESC`).all(...(orgId == null ? [user.id] : [user.id, orgId]));
  return rows.map((r) => ({ ...r, include_searches: !!r.include_searches, active: !!r.active, summary: describe(r) }));
}

export function createAlert({ user, orgId, body, owner = false }) {
  const db = getDb();
  if (Number(db.prepare(`SELECT COUNT(*) AS n FROM lead_alert WHERE user_id = ?`).get(user.id).n) >= 50) throw new HttpError(400, 'TOO_MANY_ALERTS');
  const r = clean(body);
  const id = Number(db.prepare(`INSERT INTO lead_alert (user_id, org_id, name, area, property_type, bedrooms, budget_min_aed, budget_max_aed, include_searches, active, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,?)`).run(user.id, orgId ?? null, r.name, r.area, r.property_type, r.bedrooms, r.budget_min_aed, r.budget_max_aed, owner && body.include_searches ? 1 : 0, iso()).lastInsertRowid);
  audit({ actor: user.id, org: orgId ?? null, action: 'LEAD_ALERT_CREATED', target: `lead_alert:${id}` });
  return listAlerts(user, orgId ?? null);
}

export function deleteAlert({ user, id }) {
  const db = getDb();
  const a = db.prepare('SELECT * FROM lead_alert WHERE id = ? AND user_id = ?').get(Number(id), user.id);
  if (!a) throw new HttpError(404, 'NOT_FOUND');
  db.prepare('DELETE FROM lead_alert WHERE id = ?').run(a.id);
  return { deleted: true };
}

// --- Evaluation -------------------------------------------------------------------
const criteriaOf = (interestJson) => { try { return JSON.parse(interestJson || '{}') || {}; } catch { return {}; } };

// A new Hot lead in an organization's CRM (web form, campaign, Meta, Google, pool allocation).
export function alertNewLead(leadId) {
  const db = getDb();
  const lead = db.prepare(`SELECT l.id, l.org_id, l.assigned_user_id, l.interest_json, c.full_name, o.name AS org_name FROM crm_lead l
    JOIN crm_contact c ON c.id = l.contact_id JOIN organization o ON o.id = l.org_id WHERE l.id = ?`).get(Number(leadId));
  if (!lead) return [];
  const crit = criteriaOf(lead.interest_json);
  const sent = [];
  // Members of the organization (agents only for leads assigned to them).
  const rules = db.prepare(`SELECT a.*, m.role FROM lead_alert a JOIN membership m ON m.user_id = a.user_id AND m.org_id = a.org_id AND m.status = 'ACTIVE'
    WHERE a.org_id = ? AND a.active = 1`).all(lead.org_id);
  for (const r of rules) {
    const seesAll = hasPerm({ membership: { role: r.role } }, 'crm.all');
    if (!seesAll && Number(r.user_id) !== Number(lead.assigned_user_id)) continue;
    if (!matches(r, crit)) continue;
    notify(r.user_id, lead.org_id, 'LEAD_MATCH', `⭐ “${r.name}”: ${lead.full_name} — ${describe(crit)}`, `#/crm/lead/${lead.id}`);
    sent.push(r.id);
  }
  // Platform owner rules see every account.
  for (const r of db.prepare('SELECT * FROM lead_alert WHERE org_id IS NULL AND active = 1').all()) {
    if (!matches(r, crit)) continue;
    notify(r.user_id, null, 'LEAD_MATCH', `⭐ “${r.name}”: ${lead.full_name} at ${lead.org_name} — ${describe(crit)}`, `#/owner/crm/${lead.org_id}`);
    sent.push(r.id);
  }
  return sent;
}

// A new lead waiting in the AI-DATA Hot pool (owner rules only).
export function alertNewPoolLead(poolId) {
  const db = getDb();
  const p = db.prepare('SELECT id, full_name, interest_json FROM hot_lead_pool WHERE id = ?').get(Number(poolId));
  if (!p) return [];
  const crit = criteriaOf(p.interest_json);
  const sent = [];
  for (const r of db.prepare('SELECT * FROM lead_alert WHERE org_id IS NULL AND active = 1').all()) {
    if (!matches(r, crit)) continue;
    notify(r.user_id, null, 'LEAD_MATCH', `⭐ “${r.name}”: ${p.full_name} in the Hot pool — ${describe(crit)}`, '#/live');
    sent.push(r.id);
  }
  return sent;
}

// An anonymous ai-home.world search (owner rules that opted in to search signals).
export function alertSearch(search) {
  const db = getDb();
  const ts = now();
  const sent = [];
  for (const r of db.prepare('SELECT * FROM lead_alert WHERE org_id IS NULL AND active = 1 AND include_searches = 1').all()) {
    if (!matches(r, search)) continue;
    if (r.last_search_alert_at && ts.getTime() - Date.parse(r.last_search_alert_at) < SEARCH_THROTTLE_MS) continue;
    db.prepare('UPDATE lead_alert SET last_search_alert_at = ? WHERE id = ?').run(iso(ts), r.id);
    notify(r.user_id, null, 'SEARCH_MATCH', `🔎 “${r.name}”: someone is searching ${describe(search)} on ${search.site || 'ai-home.world'} now (anonymous)`, '#/live');
    sent.push(r.id);
  }
  return sent;
}

// For the Live board: which of the viewer's rules each item matches.
export function matcherFor(user, orgId) {
  const rules = getDb().prepare(`SELECT * FROM lead_alert WHERE user_id = ? AND active = 1 AND ${orgId == null ? 'org_id IS NULL' : 'org_id = ?'}`).all(...(orgId == null ? [user.id] : [user.id, orgId]));
  return (criteria) => rules.filter((r) => matches(r, criteria)).map((r) => r.name);
}
