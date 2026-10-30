import ExcelJS from 'exceljs';
import { getDb, tx } from './db.js';
import { HttpError, iso, now, audit, notify } from './util.js';
import { hasPerm } from './auth.js';

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

export function listLeads(req, { source, stage, q, assigned } = {}) {
  const s = scope(req);
  const where = [s.sql];
  const params = [...s.params];
  if (source) { where.push('l.source_type = ?'); params.push(source); }
  if (stage) { where.push('l.stage = ?'); params.push(stage); }
  if (assigned) { where.push('l.assigned_user_id = ?'); params.push(Number(assigned)); }
  if (q) { where.push('(c.full_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  return getDb().prepare(`SELECT l.id, l.source_type, l.source_detail, l.stage, l.priority, l.first_contact_due, l.first_contacted_at, l.created_at, l.campaign_tag,
      c.full_name, c.email, c.phone, c.marketing_permission, c.suppressed, u.name AS assignee_name, l.assigned_user_id
    FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id LEFT JOIN platform_user u ON u.id = l.assigned_user_id
    WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 500`).all(...params);
}

function loadLead(req, id) {
  const s = scope(req);
  const lead = getDb().prepare(`SELECT l.*, c.full_name, c.email, c.phone, c.nationality, c.preferred_language, c.marketing_permission, c.suppressed,
      c.investor_id, c.source_type AS contact_source, c.phone_verified_at, u.name AS assignee_name
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
  };
}

export function updateLead(req, id, { stage, assigned_user_id, priority }) {
  const lead = loadLead(req, id);
  const db = getDb();
  const ts = iso();
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
  return leadDetail(req, lead.id);
}

export function addActivity(req, id, { type, body }) {
  const lead = loadLead(req, id);
  if (!ACTIVITY_TYPES.includes(type)) throw new HttpError(400, 'INVALID_ACTIVITY_TYPE');
  const outreach = ['CALL_LOGGED', 'WHATSAPP_LOGGED', 'EMAIL_LOGGED'].includes(type);
  if (outreach && lead.suppressed) throw new HttpError(403, 'CONTACT_SUPPRESSED');
  getDb().prepare('INSERT INTO lead_activity (org_id, lead_id, user_id, type, body, created_at) VALUES (?,?,?,?,?,?)')
    .run(lead.org_id, lead.id, req.user.id, type, String(body || '').slice(0, 4000), iso());
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

export function myTasks(req) {
  const s = scope(req);
  return getDb().prepare(`SELECT t.*, c.full_name, l.source_type FROM follow_up_task t JOIN crm_lead l ON l.id = t.lead_id JOIN crm_contact c ON c.id = l.contact_id
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
    WHERE m.org_id = ? AND m.status = 'ACTIVE' GROUP BY u.id ORDER BY leads DESC`).all(iso(), iso(), iso(), orgId);
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
    members: db.prepare("SELECT m.user_id, u.name, u.email, m.role, m.created_at FROM membership m JOIN platform_user u ON u.id = m.user_id WHERE m.org_id = ? AND m.status='ACTIVE' ORDER BY m.id").all(orgId),
    invitations: db.prepare('SELECT id, email, role, expires_at, accepted_at, created_at FROM invitation WHERE org_id = ? AND accepted_at IS NULL ORDER BY id DESC').all(orgId),
    seats: 'UNLIMITED',
    quota_note: 'All members share one daily Cold allowance. Adding members never changes the quota.',
  };
}

export function invite(req, { email, role }) {
  const { ORG_ROLES } = req.app.locals;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'INVALID_EMAIL');
  if (!ORG_ROLES.includes(role) || role === 'ORG_OWNER') throw new HttpError(400, 'INVALID_ROLE');
  const id = Number(getDb().prepare('INSERT INTO invitation (org_id, email, role, invited_by, expires_at, created_at) VALUES (?,?,?,?,?,?)')
    .run(req.membership.org_id, email.toLowerCase(), role, req.user.id, new Date(now().getTime() + 14 * 86_400_000).toISOString(), iso()).lastInsertRowid);
  audit({ actor: req.user.id, org: req.membership.org_id, action: 'MEMBER_INVITED', target: email.toLowerCase(), meta: { role } });
  return { id };
}

// Invitations bind to the verified Google email of the signed-in user.
export function acceptInvitations(user) {
  const db = getDb();
  const pending = db.prepare('SELECT * FROM invitation WHERE email = ? AND accepted_at IS NULL AND expires_at > ?').all(user.email.toLowerCase(), iso());
  for (const inv of pending) {
    db.prepare("INSERT INTO membership (org_id, user_id, role, status, created_at) VALUES (?,?,?,'ACTIVE',?) ON CONFLICT(org_id, user_id) DO UPDATE SET status='ACTIVE', role=excluded.role")
      .run(inv.org_id, user.id, inv.role, iso());
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
