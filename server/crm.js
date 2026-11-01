import ExcelJS from 'exceljs';
import { getDb, tx } from './db.js';
import { HttpError, iso, now, audit, notify, dubaiDay, cleanEmail, cleanName, requireMobile } from './util.js';
import { activeSubscription } from './entitlements.js';
import { hasPerm } from './auth.js';
import { cleanPreferences } from './dashboard.js';

export const STAGES = ['NEW', 'ASSIGNED', 'CONTACT_ATTEMPTED', 'CONTACTED', 'QUALIFIED', 'INTERESTED', 'VIEWING_SCHEDULED', 'VIEWED',
  'NEGOTIATION', 'BOOKING', 'CONTRACT', 'CLOSED_WON', 'CLOSED_LOST', 'NO_RESPONSE', 'ON_HOLD'];
const CONTACTED_STAGES = new Set(STAGES.slice(STAGES.indexOf('CONTACTED')));
export const ACTIVITY_TYPES = ['NOTE', 'CALL_LOGGED', 'WHATSAPP_LOGGED', 'EMAIL_LOGGED', 'MEETING', 'VIEWING', 'CONTACT_ATTEMPT'];

// Agents see only leads assigned to them; managers see the whole tenant. Every query
// is pinned to the session's active organization.
function scope(req) {
  const orgId = req.membership.org_id;
  if (hasPerm(req, 'crm.all')) return { sql: 'l.org_id = ?', params: [orgId] };
  return { sql: 'l.org_id = ? AND l.assigned_user_id = ?', params: [orgId, req.user.id] };
}

export function listLeads(req, { source, stage, q, assigned, tag, overdue } = {}) {
  const s = scope(req);
  const where = [s.sql];
  const params = [...s.params];
  if (source) { where.push('l.source_type = ?'); params.push(source); }
  if (stage) { where.push('l.stage = ?'); params.push(stage); }
  if (assigned) { where.push('l.assigned_user_id = ?'); params.push(Number(assigned)); }
  if (tag) { where.push("(',' || COALESCE(l.tags,'') || ',') LIKE ?"); params.push(`%,${normTag(tag)},%`); }
  if (overdue) { where.push('EXISTS (SELECT 1 FROM follow_up_task t WHERE t.lead_id = l.id AND t.done_at IS NULL AND t.due_at < ?)'); params.push(iso()); }
  if (q) { where.push('(lower(c.full_name) LIKE ? OR lower(c.email) LIKE ? OR lower(c.phone) LIKE ?)'); const like = `%${String(q).toLowerCase()}%`; params.push(like, like, like); }
  return getDb().prepare(`SELECT l.id, l.source_type, l.source_detail, l.stage, l.priority, l.first_contact_due, l.first_contacted_at, l.created_at, l.campaign_tag,
      l.deal_value_aed, l.expected_close, l.tags,
      (SELECT MIN(t.due_at) FROM follow_up_task t WHERE t.lead_id = l.id AND t.done_at IS NULL) AS next_task_due,
      c.full_name, c.email, c.phone, c.marketing_permission, c.suppressed, u.name AS assignee_name, l.assigned_user_id
    FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id LEFT JOIN platform_user u ON u.id = l.assigned_user_id
    WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 500`).all(...params);
}

function loadLead(req, id) {
  const s = scope(req);
  const lead = getDb().prepare(`SELECT l.*, c.full_name, c.email, c.phone, c.nationality, c.preferred_language, c.marketing_permission, c.suppressed,
      c.investor_id, c.source_type AS contact_source, c.phone_verified_at, c.preferred_channel, c.best_time, c.tone, u.name AS assignee_name
    FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id LEFT JOIN platform_user u ON u.id = l.assigned_user_id
    WHERE l.id = ? AND ${s.sql}`).get(Number(id), ...s.params);
  if (!lead) throw new HttpError(404, 'NOT_FOUND');
  return lead;
}

export function leadDetail(req, id) {
  const lead = loadLead(req, id);
  const db = getDb();
  audit({ actor: req.user.id, org: lead.org_id, action: 'CRM_LEAD_VIEWED', target: `lead:${lead.id}` });
  return {
    ...lead,
    interest: lead.interest_json ? JSON.parse(lead.interest_json) : null,
    consent: lead.consent_json ? JSON.parse(lead.consent_json) : null,
    outreach_allowed: lead.suppressed ? false : lead.marketing_permission === 'GRANTED',
    activities: db.prepare('SELECT a.*, u.name AS user_name FROM lead_activity a LEFT JOIN platform_user u ON u.id = a.user_id WHERE a.lead_id = ? ORDER BY a.created_at DESC').all(lead.id),
    tasks: db.prepare('SELECT * FROM follow_up_task WHERE lead_id = ? ORDER BY due_at').all(lead.id),
    duplicates: duplicatesOf(req, lead),
  };
}

// Other leads in the same organization with the same mobile or email (the person may
// have enquired twice, or exist as Cold and Hot). Shown as a warning; never merged.
function duplicatesOf(req, lead) {
  if (!lead.phone && !lead.email) return [];
  const s = scope(req);
  return getDb().prepare(`SELECT l.id, l.stage, l.source_type, c.full_name, u.name AS assignee_name FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id
      LEFT JOIN platform_user u ON u.id = l.assigned_user_id
    WHERE ${s.sql} AND l.id != ? AND ((c.phone IS NOT NULL AND c.phone = ?) OR (c.email IS NOT NULL AND lower(c.email) = lower(?))) ORDER BY l.id LIMIT 10`)
    .all(...s.params, lead.id, lead.phone ?? null, lead.email ?? null);
}

const normTag = (t) => String(t || '').trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, '-').slice(0, 30);
export function parseTags(input) {
  const list = (Array.isArray(input) ? input : String(input ?? '').split(',')).map(normTag).filter(Boolean);
  return [...new Set(list)].slice(0, 10);
}

export function updateLead(req, id, { stage, assigned_user_id, priority, deal_value_aed, expected_close, tags, preferences }) {
  const lead = loadLead(req, id);
  const db = getDb();
  const ts = iso();
  if (preferences && typeof preferences === 'object') {
    const p = cleanPreferences(preferences);
    for (const [col, val] of Object.entries(p)) db.prepare(`UPDATE crm_contact SET ${col} = ?, updated_at = ? WHERE id = ? AND org_id = ?`).run(val, ts, lead.contact_id, lead.org_id);
  }
  if (stage) {
    if (!STAGES.includes(stage)) throw new HttpError(400, 'INVALID_STAGE');
    db.prepare('UPDATE crm_lead SET stage = ?, updated_at = ? WHERE id = ?').run(stage, ts, lead.id);
    db.prepare('INSERT INTO lead_activity (org_id, lead_id, user_id, type, body, created_at) VALUES (?,?,?,?,?,?)').run(lead.org_id, lead.id, req.user.id, 'STAGE_CHANGE', `${lead.stage} → ${stage}`, ts);
    // A click-to-call is not a conversation: first contact is only recorded on an explicit stage the agent sets.
    if (!lead.first_contacted_at && CONTACTED_STAGES.has(stage)) db.prepare('UPDATE crm_lead SET first_contacted_at = ? WHERE id = ?').run(ts, lead.id);
  }
  if (assigned_user_id != null) {
    if (!hasPerm(req, 'crm.all')) throw new HttpError(403, 'FORBIDDEN');
    const m = db.prepare("SELECT 1 FROM membership WHERE org_id = ? AND user_id = ? AND status='ACTIVE'").get(lead.org_id, Number(assigned_user_id));
    if (!m) throw new HttpError(400, 'ASSIGNEE_NOT_IN_ORGANIZATION');
    db.prepare('UPDATE crm_lead SET assigned_user_id = ?, updated_at = ? WHERE id = ?').run(Number(assigned_user_id), ts, lead.id);
    db.prepare('INSERT INTO lead_activity (org_id, lead_id, user_id, type, body, created_at) VALUES (?,?,?,?,?,?)').run(lead.org_id, lead.id, req.user.id, 'REASSIGNED', `Assigned to user ${assigned_user_id}`, ts);
    notify(Number(assigned_user_id), lead.org_id, 'LEAD_ASSIGNED', `Lead assigned to you: ${lead.full_name}`, `#/crm/lead/${lead.id}`);
  }
  if (priority) {
    if (!['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority)) throw new HttpError(400, 'INVALID_PRIORITY');
    db.prepare('UPDATE crm_lead SET priority = ?, updated_at = ? WHERE id = ?').run(priority, ts, lead.id);
  }
  if (deal_value_aed !== undefined) {
    const v = deal_value_aed === null || deal_value_aed === '' ? null : Math.round(Number(deal_value_aed));
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 10_000_000_000)) throw new HttpError(400, 'INVALID_DEAL_VALUE');
    db.prepare('UPDATE crm_lead SET deal_value_aed = ?, updated_at = ? WHERE id = ?').run(v, ts, lead.id);
  }
  if (expected_close !== undefined) {
    const d = expected_close || null;
    if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'INVALID_DATE');
    db.prepare('UPDATE crm_lead SET expected_close = ?, updated_at = ? WHERE id = ?').run(d, ts, lead.id);
  }
  if (tags !== undefined) {
    db.prepare('UPDATE crm_lead SET tags = ?, updated_at = ? WHERE id = ?').run(parseTags(tags).join(',') || null, ts, lead.id);
  }
  return leadDetail(req, lead.id);
}

export function addActivity(req, id, { type, body, template_id }) {
  const lead = loadLead(req, id);
  if (!ACTIVITY_TYPES.includes(type)) throw new HttpError(400, 'INVALID_ACTIVITY_TYPE');
  const outreach = ['CALL_LOGGED', 'WHATSAPP_LOGGED', 'EMAIL_LOGGED'].includes(type);
  if (outreach && lead.suppressed) throw new HttpError(403, 'CONTACT_SUPPRESSED');
  let templateId = null;
  if (template_id != null && template_id !== '') {
    const tpl = getDb().prepare('SELECT id FROM message_template WHERE id = ? AND org_id = ?').get(Number(template_id), lead.org_id);
    if (!tpl) throw new HttpError(400, 'UNKNOWN_TEMPLATE');
    templateId = tpl.id;
  }
  getDb().prepare('INSERT INTO lead_activity (org_id, lead_id, user_id, type, body, created_at, template_id) VALUES (?,?,?,?,?,?,?)')
    .run(lead.org_id, lead.id, req.user.id, type, String(body || '').slice(0, 4000), iso(), templateId);
  return leadDetail(req, lead.id);
}

export function addTask(req, id, { title, due_at }) {
  const lead = loadLead(req, id);
  if (!title || !due_at || Number.isNaN(Date.parse(due_at))) throw new HttpError(400, 'TITLE_AND_DUE_REQUIRED');
  getDb().prepare('INSERT INTO follow_up_task (org_id, lead_id, assignee_id, title, due_at, created_at) VALUES (?,?,?,?,?,?)')
    .run(lead.org_id, lead.id, lead.assigned_user_id ?? req.user.id, String(title).slice(0, 300), new Date(due_at).toISOString(), iso());
  return leadDetail(req, lead.id);
}

export function completeTask(req, taskId) {
  const t = getDb().prepare('SELECT * FROM follow_up_task WHERE id = ? AND org_id = ?').get(Number(taskId), req.membership.org_id);
  if (!t) throw new HttpError(404, 'NOT_FOUND');
  loadLead(req, t.lead_id);
  getDb().prepare('UPDATE follow_up_task SET done_at = ? WHERE id = ?').run(iso(), t.id);
  return { ok: true };
}

// Several leads at once: stage, assignee and/or a tag. Each lead goes through the same
// checks as a single update, so agents can only touch their own leads.
export function bulkUpdate(req, { ids, stage, assigned_user_id, add_tag }) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
  if (!list.length) throw new HttpError(400, 'EMPTY_SELECTION');
  if (list.length > 200) throw new HttpError(400, 'SELECTION_TOO_LARGE', 'At most 200 leads at a time.');
  if (!stage && assigned_user_id == null && !add_tag) throw new HttpError(400, 'NOTHING_TO_CHANGE');
  const tag = add_tag ? normTag(add_tag) : null;
  return tx(() => {
    let updated = 0;
    for (const id of list) {
      const lead = loadLead(req, id);
      const tags = tag ? parseTags([...(lead.tags ? lead.tags.split(',') : []), tag]).join(',') : undefined;
      updateLead(req, id, { stage: stage || undefined, assigned_user_id: assigned_user_id ?? undefined, tags });
      updated++;
    }
    audit({ actor: req.user.id, org: req.membership.org_id, action: 'CRM_BULK_UPDATE', meta: { count: updated, stage, assigned_user_id, add_tag: tag } });
    return { updated };
  });
}

export function snoozeTask(req, taskId, { days = 1 } = {}) {
  const t = getDb().prepare('SELECT * FROM follow_up_task WHERE id = ? AND org_id = ? AND done_at IS NULL').get(Number(taskId), req.membership.org_id);
  if (!t) throw new HttpError(404, 'NOT_FOUND');
  loadLead(req, t.lead_id);
  const n = Math.min(Math.max(Number(days) || 1, 1), 30);
  const base = Math.max(Date.parse(t.due_at), now().getTime());
  const due = new Date(base + n * 86_400_000).toISOString();
  getDb().prepare('UPDATE follow_up_task SET due_at = ? WHERE id = ?').run(due, t.id);
  return { id: t.id, due_at: due };
}

// Ready-made messages; {name}, {agent}, {area}, {company} are filled in on the lead page.
export const BUILTIN_TEMPLATES = [
  { id: 'b-intro-en', name: 'First contact (EN)', channel: 'WHATSAPP', language: 'en', body: 'Hello {name}, this is {agent} from {company}. You recently showed interest in property in {area}. When would be a good time for a short call?' },
  { id: 'b-intro-ar', name: 'أول تواصل (AR)', channel: 'WHATSAPP', language: 'ar', body: 'مرحباً {name}، معك {agent} من {company}. لاحظنا اهتمامك بعقار في {area}. متى يناسبك اتصال قصير؟' },
  { id: 'b-follow-en', name: 'Follow-up after call (EN)', channel: 'WHATSAPP', language: 'en', body: 'Hi {name}, thank you for your time today. As promised, I will share options in {area} that match what you are looking for. — {agent}, {company}' },
  { id: 'b-viewing-en', name: 'Viewing confirmation (EN)', channel: 'WHATSAPP', language: 'en', body: 'Hi {name}, confirming your viewing in {area}. Please reply YES to confirm or suggest another time. — {agent}' },
  { id: 'b-email-en', name: 'Options by email (EN)', channel: 'EMAIL', language: 'en', body: 'Dear {name},\n\nThank you for your interest in {area}. Please find below a selection of properties that match your requirements.\n\nKind regards,\n{agent}\n{company}' },
];

export function listTemplates(req) {
  const own = getDb().prepare('SELECT id, name, channel, language, body FROM message_template WHERE org_id = ? ORDER BY id DESC').all(req.membership.org_id);
  return [...own.map((t) => ({ ...t, custom: true })), ...BUILTIN_TEMPLATES];
}

export function createTemplate(req, { name, channel, language, body }) {
  const n = String(name || '').trim().slice(0, 80);
  const b = String(body || '').trim().slice(0, 2000);
  if (!n || !b) throw new HttpError(400, 'NAME_AND_TEXT_REQUIRED');
  if (!['WHATSAPP', 'EMAIL'].includes(channel)) throw new HttpError(400, 'INVALID_CHANNEL');
  const id = Number(getDb().prepare('INSERT INTO message_template (org_id, name, channel, language, body, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(req.membership.org_id, n, channel, ['en', 'ar', 'fr', 'ru', 'tr'].includes(language) ? language : 'en', b, req.user.id, iso()).lastInsertRowid);
  return { id };
}

export function deleteTemplate(req, id) {
  const r = getDb().prepare('DELETE FROM message_template WHERE id = ? AND org_id = ?').run(Number(id), req.membership.org_id);
  if (!r.changes) throw new HttpError(404, 'NOT_FOUND');
  return { ok: true };
}

export function myTasks(req) {
  const s = scope(req);
  return getDb().prepare(`SELECT t.*, c.full_name, c.phone, l.source_type, l.stage FROM follow_up_task t JOIN crm_lead l ON l.id = t.lead_id JOIN crm_contact c ON c.id = l.contact_id
    WHERE ${s.sql} AND t.done_at IS NULL ORDER BY t.due_at LIMIT 200`).all(...s.params);
}

export function pipeline(req) {
  const s = scope(req);
  const rows = getDb().prepare(`SELECT l.stage, l.source_type, COUNT(*) AS n FROM crm_lead l WHERE ${s.sql} GROUP BY l.stage, l.source_type`).all(...s.params);
  return STAGES.map((st) => ({ stage: st, total: rows.filter((r) => r.stage === st).reduce((a, r) => a + r.n, 0), by_source: Object.fromEntries(rows.filter((r) => r.stage === st).map((r) => [r.source_type, r.n])) }));
}

// --- Reports: Cold transferred vs Hot acquired vs organic kept separate; agent score
// uses explicit denominators and configurable weights.
export const DEFAULT_SCORE_WEIGHTS = { sla: 0.35, followups: 0.25, qualification: 0.25, hygiene: 0.15 };

export function reports(req) {
  const orgId = req.membership.org_id;
  const db = getDb();
  const bySource = db.prepare(`SELECT source_type, COUNT(*) AS leads,
      SUM(CASE WHEN first_contacted_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted,
      SUM(CASE WHEN stage IN ('QUALIFIED','INTERESTED','VIEWING_SCHEDULED','VIEWED','NEGOTIATION','BOOKING','CONTRACT','CLOSED_WON') THEN 1 ELSE 0 END) AS qualified,
      SUM(CASE WHEN stage = 'CLOSED_WON' THEN 1 ELSE 0 END) AS won
    FROM crm_lead WHERE org_id = ? GROUP BY source_type`).all(orgId);
  const agents = db.prepare(`SELECT u.id, u.name, m.role,
      COUNT(l.id) AS leads,
      SUM(CASE WHEN l.first_contact_due IS NOT NULL AND l.first_contacted_at IS NOT NULL AND l.first_contacted_at <= l.first_contact_due THEN 1 ELSE 0 END) AS sla_met,
      SUM(CASE WHEN l.first_contact_due IS NOT NULL AND (l.first_contacted_at IS NOT NULL OR l.first_contact_due < ?) THEN 1 ELSE 0 END) AS sla_due,
      SUM(CASE WHEN l.stage IN ('QUALIFIED','INTERESTED','VIEWING_SCHEDULED','VIEWED','NEGOTIATION','BOOKING','CONTRACT','CLOSED_WON') THEN 1 ELSE 0 END) AS qualified,
      SUM(CASE WHEN l.first_contacted_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted,
      SUM(CASE WHEN l.stage = 'CLOSED_WON' THEN 1 ELSE 0 END) AS won,
      (SELECT COUNT(*) FROM follow_up_task t WHERE t.assignee_id = u.id AND t.org_id = m.org_id AND t.due_at < ?) AS tasks_due,
      (SELECT COUNT(*) FROM follow_up_task t WHERE t.assignee_id = u.id AND t.org_id = m.org_id AND t.due_at < ? AND t.done_at IS NOT NULL AND t.done_at <= t.due_at) AS tasks_on_time,
      (SELECT COUNT(DISTINCT a.lead_id) FROM lead_activity a WHERE a.user_id = u.id AND a.org_id = m.org_id AND a.type IN ('NOTE','CALL_LOGGED','WHATSAPP_LOGGED','EMAIL_LOGGED','MEETING','VIEWING','CONTACT_ATTEMPT')) AS leads_with_notes
    FROM membership m JOIN platform_user u ON u.id = m.user_id LEFT JOIN crm_lead l ON l.assigned_user_id = u.id AND l.org_id = m.org_id
    WHERE m.org_id = ? AND m.status = 'ACTIVE' GROUP BY u.id, u.name, m.role, m.org_id ORDER BY leads DESC`).all(iso(), iso(), iso(), orgId);
  const w = DEFAULT_SCORE_WEIGHTS;
  const ratio = (a, b) => (b ? a / b : null);
  const scored = agents.map((a) => {
    const parts = { sla: ratio(a.sla_met, a.sla_due), followups: ratio(a.tasks_on_time, a.tasks_due), qualification: ratio(a.qualified, a.contacted), hygiene: ratio(a.leads_with_notes, a.leads) };
    const present = Object.entries(parts).filter(([, v]) => v != null);
    const weight = present.reduce((s, [k]) => s + w[k], 0);
    const score = weight ? Math.round((present.reduce((s, [k, v]) => s + v * w[k], 0) / weight) * 100) : null;
    return { ...a, score, score_parts: parts, score_note: score == null ? 'Not enough activity to score' : `Weighted over ${present.map(([k]) => k).join(', ')}` };
  });
  const searchDemand = db.prepare(`SELECT area, property_type, bedrooms, COUNT(*) AS searches, MAX(budget_max_aed) AS max_budget
    FROM anonymous_search_event GROUP BY area, property_type, bedrooms ORDER BY searches DESC LIMIT 20`).all();
  return { by_source: bySource, agents: scored, weights: w, first_party_search_demand: searchDemand, note: 'Cold historical transfers are reported separately from Hot inquiries and are not counted as new-inquiry conversions.' };
}

// --- SLA worker: real scheduled sweep, not a badge. ---------------------------------
export function runSlaSweep() {
  const db = getDb();
  const ts = iso();
  const overdue = db.prepare(`SELECT l.id, l.org_id, l.assigned_user_id, l.escalation_level, l.first_contact_due, c.full_name, l.source_type
    FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id
    WHERE l.first_contacted_at IS NULL AND l.first_contact_due < ? AND l.escalation_level < 2 AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','ON_HOLD')`).all(ts);
  let sent = 0;
  for (const l of overdue) {
    const level = l.escalation_level + 1;
    if (level === 1 && l.assigned_user_id) {
      notify(l.assigned_user_id, l.org_id, 'SLA_MISSED', `First-contact SLA missed: ${l.full_name} (${l.source_type})`, `#/crm/lead/${l.id}`);
      sent++;
    } else {
      const managers = db.prepare("SELECT user_id FROM membership WHERE org_id = ? AND status='ACTIVE' AND role IN ('TEAM_LEADER','SALES_MANAGER','AGENCY_DIRECTOR','ORG_OWNER')").all(l.org_id);
      for (const m of managers) { notify(m.user_id, l.org_id, 'SLA_ESCALATION', `Escalation: ${l.full_name} still has no first contact`, `#/crm/lead/${l.id}`); sent++; }
    }
    db.prepare('UPDATE crm_lead SET escalation_level = ? WHERE id = ?').run(level, l.id);
    db.prepare('INSERT INTO lead_activity (org_id, lead_id, type, body, created_at) VALUES (?,?,?,?,?)').run(l.org_id, l.id, 'SLA_ESCALATION', `Escalation level ${level}`, ts);
  }
  return { checked: overdue.length, notifications: sent };
}

// --- Members & invitations ---------------------------------------------------------
export function members(orgId) {
  const db = getDb();
  return {
    members: db.prepare(`SELECT m.user_id, u.name, u.email, u.phone, m.role, m.daily_cap, m.created_at,
        (SELECT COALESCE(SUM(l.delta),0) FROM quota_ledger l WHERE l.org_id = m.org_id AND l.user_id = m.user_id AND l.local_day = ?) AS used_today
      FROM membership m JOIN platform_user u ON u.id = m.user_id WHERE m.org_id = ? AND m.status='ACTIVE' ORDER BY m.id`).all(dubaiDay(), orgId),
    invitations: db.prepare('SELECT id, email, full_name, phone, role, daily_cap, expires_at, accepted_at, created_at FROM invitation WHERE org_id = ? AND accepted_at IS NULL ORDER BY id DESC').all(orgId),
    seats: 'UNLIMITED',
    account_limit: activeSubscription(orgId)?.cold_daily_limit ?? null,
    quota_note: 'All members share the account\'s daily Cold allowance. The director can also give each member a personal daily cap inside it.',
  };
}

function parseCap(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100_000) throw new HttpError(400, 'INVALID_CAP', 'Daily limit must be a whole number (or empty for no personal limit).');
  return n;
}

export function invite(req, { email, role, full_name, phone, daily_cap }) {
  const { ORG_ROLES } = req.app.locals;
  const mail = cleanEmail(email);
  if (!ORG_ROLES.includes(role) || role === 'ORG_OWNER') throw new HttpError(400, 'INVALID_ROLE');
  const name = full_name ? cleanName(full_name) : null;
  const mobile = phone ? requireMobile(phone) : null;
  const cap = parseCap(daily_cap);
  const id = Number(getDb().prepare('INSERT INTO invitation (org_id, email, full_name, phone, role, daily_cap, invited_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.membership.org_id, mail, name, mobile, role, cap, req.user.id, new Date(now().getTime() + 14 * 86_400_000).toISOString(), iso()).lastInsertRowid);
  audit({ actor: req.user.id, org: req.membership.org_id, action: 'MEMBER_INVITED', target: mail, meta: { role, daily_cap: cap } });
  return { id };
}

export function setMemberCap(req, userId, value) {
  const db = getDb();
  const orgId = req.membership.org_id;
  const m = db.prepare("SELECT m.role FROM membership m WHERE m.org_id = ? AND m.user_id = ? AND m.status='ACTIVE'").get(orgId, Number(userId));
  if (!m) throw new HttpError(404, 'NOT_A_MEMBER');
  const cap = parseCap(value);
  db.prepare('UPDATE membership SET daily_cap = ? WHERE org_id = ? AND user_id = ?').run(cap, orgId, Number(userId));
  audit({ actor: req.user.id, org: orgId, action: 'MEMBER_CAP_SET', target: `user:${userId}`, meta: { daily_cap: cap } });
  return { user_id: Number(userId), daily_cap: cap };
}

// Invitations bind to the verified Google email of the signed-in user.
export function acceptInvitations(user) {
  const db = getDb();
  const pending = db.prepare('SELECT * FROM invitation WHERE email = ? AND accepted_at IS NULL AND expires_at > ?').all(user.email.toLowerCase(), iso());
  for (const inv of pending) {
    db.prepare("INSERT INTO membership (org_id, user_id, role, status, daily_cap, created_at) VALUES (?,?,?,'ACTIVE',?,?) ON CONFLICT(org_id, user_id) DO UPDATE SET status='ACTIVE', role=excluded.role, daily_cap=excluded.daily_cap")
      .run(inv.org_id, user.id, inv.role, inv.daily_cap ?? null, iso());
    // Details the director entered fill in a profile the person has not completed yet.
    if (inv.phone && !user.phone) {
      db.prepare('UPDATE platform_user SET phone = ?, name = COALESCE(?, name) WHERE id = ? AND phone IS NULL').run(inv.phone, inv.full_name, user.id);
    }
    db.prepare('UPDATE invitation SET accepted_at = ?, accepted_by = ? WHERE id = ?').run(iso(), user.id, inv.id);
    audit({ actor: user.id, org: inv.org_id, action: 'INVITATION_ACCEPTED', target: `invitation:${inv.id}` });
  }
  return pending.length;
}

export function removeMember(req, userId) {
  const org = getDb().prepare('SELECT owner_user_id FROM organization WHERE id = ?').get(req.membership.org_id);
  if (Number(userId) === org.owner_user_id) throw new HttpError(400, 'CANNOT_REMOVE_OWNER');
  getDb().prepare("UPDATE membership SET status='REMOVED' WHERE org_id = ? AND user_id = ?").run(req.membership.org_id, Number(userId));
  audit({ actor: req.user.id, org: req.membership.org_id, action: 'MEMBER_REMOVED', target: `user:${userId}` });
}

// --- leads form.xlsx import (38 original columns preserved in raw_import_json) ------
export const LEADS_FORM_COLUMNS = ['contactId', 'salutationId', 'salutation', 'fullName', 'landline', 'mobile', 'whatsappNumber', 'email', 'leadId', 'leadType',
  'leadClass', 'unitType', 'Country', 'CITY', 'district', 'community', 'propertyName', 'Currency', 'budgetFrom', 'budgetTo', 'area Measurment', 'sizeAreaFrom',
  'sizeAreaTo', 'specification', 'methodOfContact', 'mediaName', 'mediaDetails', 'leadStatus', 'leadRating', 'contactEnteredBy', 'leadEnteredBy', 'referredTo',
  'referredBy', 'leadEnteredDateTime', 'enteredByDept', 'transaction', 'requiredDate', 'nationality'];

export function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (/^05\d{8}$/.test(d)) d = '+971' + d.slice(1);
  if (!d.startsWith('+')) d = '+' + d;
  return /^\+\d{8,15}$/.test(d) ? d : null;
}

export async function importLeadsXlsx(req, { base64, commit, rightsConfirmed }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(String(base64 || ''), 'base64'));
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, 'EMPTY_WORKBOOK');
  const header = ws.getRow(1).values.slice(1).map((v) => String(v ?? '').trim());
  const missing = LEADS_FORM_COLUMNS.filter((c) => !header.includes(c));
  const rows = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const raw = Object.fromEntries(header.map((h, j) => [h, row.getCell(j + 1).text?.trim() || null]));
    const errors = [];
    if (!raw.fullName) errors.push('fullName missing');
    const mobile = normalizePhone(raw.mobile || raw.whatsappNumber || raw.landline);
    const email = raw.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.email) ? raw.email.toLowerCase() : null;
    if (!mobile && !email) errors.push('no valid phone or email');
    rows.push({ row: i, raw, mapped: { full_name: raw.fullName, phone: mobile, email, nationality: raw.nationality, interest: { unitType: raw.unitType, city: raw.CITY, community: raw.community, budgetFrom: raw.budgetFrom, budgetTo: raw.budgetTo, currency: raw.Currency, transaction: raw.transaction } }, errors });
  });
  const preview = { columns_found: header.length, missing_columns: missing, rows: rows.length, valid: rows.filter((r) => !r.errors.length).length, sample: rows.slice(0, 10) };
  if (!commit) return preview;
  if (!rightsConfirmed) throw new HttpError(400, 'RIGHTS_CONFIRMATION_REQUIRED', 'Confirm you hold the rights to import these contacts.');
  const orgId = req.membership.org_id;
  const created = tx((conn) => {
    let n = 0;
    const ts = iso();
    for (const r of rows.filter((x) => !x.errors.length)) {
      const dup = r.mapped.email && conn.prepare('SELECT id FROM crm_contact WHERE org_id = ? AND lower(email) = ?').get(orgId, r.mapped.email);
      if (dup) continue; // duplicates are left for manual review, never auto-merged
      const cid = Number(conn.prepare(`INSERT INTO crm_contact (org_id, full_name, email, phone, nationality, source_type, raw_import_json, created_at, updated_at)
        VALUES (?,?,?,?,?,'MANUAL',?,?,?)`).run(orgId, r.mapped.full_name, r.mapped.email, r.mapped.phone, r.mapped.nationality, JSON.stringify(r.raw), ts, ts).lastInsertRowid);
      conn.prepare(`INSERT INTO crm_lead (org_id, contact_id, source_type, source_detail, stage, assigned_user_id, interest_json, created_at, updated_at)
        VALUES (?,?,'MANUAL','XLSX_IMPORT','NEW',?,?,?,?)`).run(orgId, cid, req.user.id, JSON.stringify(r.mapped.interest), ts, ts);
      n++;
    }
    return n;
  });
  audit({ actor: req.user.id, org: orgId, action: 'CRM_IMPORT', meta: { created, rows: rows.length } });
  return { ...preview, created };
}

// --- Agents joining an agency -----------------------------------------------------------
// An agent who signs in "under an agency" asks to join it; the agency approves (choosing
// role and daily limit) or declines. Invitations by email still join directly.
const MANAGER_ROLES = ['ORG_OWNER', 'AGENCY_DIRECTOR', 'ORG_ADMIN'];

// Agencies a person can ask to join. Names only; customer accounts of the platform owners
// (their own follow-up CRM) are not listed.
export function searchAgencies(q) {
  const term = String(q || '').trim().toLowerCase();
  if (term.length < 2) return [];
  return getDb().prepare(`SELECT o.id, o.name FROM organization o JOIN platform_user u ON u.id = o.owner_user_id
    WHERE o.kind = 'AGENCY' AND u.platform_role IS NULL AND lower(o.name) LIKE ? ORDER BY o.name LIMIT 8`).all(`%${term}%`);
}

export function agencyById(id) {
  const org = getDb().prepare(`SELECT o.id, o.name FROM organization o JOIN platform_user u ON u.id = o.owner_user_id
    WHERE o.id = ? AND o.kind = 'AGENCY' AND u.platform_role IS NULL`).get(Number(id));
  if (!org) throw new HttpError(400, 'AGENCY_NOT_FOUND', 'Choose your agency from the list.');
  return org;
}

export function requestToJoin(user, orgId) {
  const db = getDb();
  const org = agencyById(orgId);
  if (db.prepare("SELECT 1 FROM membership WHERE org_id = ? AND user_id = ? AND status = 'ACTIVE'").get(org.id, user.id)) return { status: 'MEMBER', org };
  const open = db.prepare("SELECT id FROM join_request WHERE org_id = ? AND user_id = ? AND status = 'PENDING'").get(org.id, user.id);
  if (open) return { status: 'PENDING', org, id: open.id };
  const id = Number(db.prepare("INSERT INTO join_request (org_id, user_id, status, created_at) VALUES (?,?,'PENDING',?)").run(org.id, user.id, iso()).lastInsertRowid);
  const managers = db.prepare(`SELECT user_id FROM membership WHERE org_id = ? AND status = 'ACTIVE' AND role IN (${MANAGER_ROLES.map(() => '?').join(',')})`).all(org.id, ...MANAGER_ROLES);
  for (const m of managers) notify(m.user_id, org.id, 'JOIN_REQUEST', `${user.name} (${user.email}) asks to join ${org.name} as an agent. Approve on the Team page.`, '#/team');
  audit({ actor: user.id, org: org.id, action: 'JOIN_REQUESTED', target: `join:${id}` });
  return { status: 'PENDING', org, id };
}

export function myJoinRequests(userId) {
  return getDb().prepare(`SELECT j.id, j.status, j.created_at, j.decided_at, o.id AS org_id, o.name AS org_name FROM join_request j JOIN organization o ON o.id = j.org_id
    WHERE j.user_id = ? AND (j.status = 'PENDING' OR j.decided_at > ?) ORDER BY j.id DESC LIMIT 5`).all(userId, new Date(now().getTime() - 7 * 86_400_000).toISOString());
}

export function cancelJoinRequest(user, id) {
  const r = getDb().prepare("UPDATE join_request SET status = 'CANCELLED', decided_at = ? WHERE id = ? AND user_id = ? AND status = 'PENDING'").run(iso(), Number(id), user.id);
  if (!r.changes) throw new HttpError(404, 'NOT_FOUND');
  return { ok: true };
}

export function orgJoinRequests(orgId) {
  return getDb().prepare(`SELECT j.id, j.created_at, u.id AS user_id, u.name, u.email, u.phone FROM join_request j JOIN platform_user u ON u.id = j.user_id
    WHERE j.org_id = ? AND j.status = 'PENDING' ORDER BY j.id`).all(orgId);
}

export function decideJoinRequest(req, id, { approve, role = 'AGENT', daily_cap }) {
  const db = getDb();
  const orgId = req.membership.org_id;
  const j = db.prepare("SELECT * FROM join_request WHERE id = ? AND org_id = ? AND status = 'PENDING'").get(Number(id), orgId);
  if (!j) throw new HttpError(404, 'NOT_FOUND');
  const ts = iso();
  const org = db.prepare('SELECT name FROM organization WHERE id = ?').get(orgId);
  if (!approve) {
    db.prepare("UPDATE join_request SET status = 'DECLINED', decided_by = ?, decided_at = ? WHERE id = ?").run(req.user.id, ts, j.id);
    notify(j.user_id, null, 'JOIN_DECLINED', `${org.name} did not approve your request to join.`, '#/onboarding');
    audit({ actor: req.user.id, org: orgId, action: 'JOIN_DECLINED', target: `user:${j.user_id}` });
    return { status: 'DECLINED' };
  }
  const { ORG_ROLES } = req.app.locals;
  if (!ORG_ROLES.includes(role) || role === 'ORG_OWNER') throw new HttpError(400, 'INVALID_ROLE');
  const cap = parseCap(daily_cap);
  tx((conn) => {
    conn.prepare("INSERT INTO membership (org_id, user_id, role, status, daily_cap, created_at) VALUES (?,?,?,'ACTIVE',?,?) ON CONFLICT(org_id, user_id) DO UPDATE SET status='ACTIVE', role=excluded.role, daily_cap=excluded.daily_cap")
      .run(orgId, j.user_id, role, cap, ts);
    conn.prepare("UPDATE join_request SET status = 'APPROVED', decided_by = ?, decided_at = ? WHERE id = ?").run(req.user.id, ts, j.id);
    // The agent works in this agency from now on: open their sessions on it.
    conn.prepare('UPDATE session SET active_org_id = ? WHERE user_id = ? AND active_org_id IS NULL').run(orgId, j.user_id);
  });
  notify(j.user_id, orgId, 'JOIN_APPROVED', `Welcome to ${org.name}! You can start working now.`, '#/overview');
  audit({ actor: req.user.id, org: orgId, action: 'JOIN_APPROVED', target: `user:${j.user_id}`, meta: { role, daily_cap: cap } });
  return { status: 'APPROVED' };
}
