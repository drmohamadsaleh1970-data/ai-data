// CRM dashboard: pipeline, follow-ups, first-contact SLA, team activity and how clients
// like to be contacted. One builder serves every role; the caller decides the scope:
//   - an agent (crm.own) sees only the leads assigned to them;
//   - agency managers (crm.all) see their whole organization and each agent in it;
//   - the platform owner sees any organization, agency or solo agent (server/app.js
//     /owner/orgs/:id/crm/*), and nobody else can see a solo agent's CRM.
// Aggregation is done in JavaScript over the organization's own rows, so the same code
// runs unchanged on SQLite and Postgres.
import { getDb } from './db.js';
import { HttpError, iso, now, audit, notify, dubaiDay, maskEmail, maskPhone } from './util.js';
import { STAGES } from './crm.js';
import { hasPerm } from './auth.js';

export const CLOSED_STAGES = ['CLOSED_WON', 'CLOSED_LOST'];
export const OUTREACH_TYPES = ['CALL_LOGGED', 'WHATSAPP_LOGGED', 'EMAIL_LOGGED', 'MEETING', 'VIEWING', 'CONTACT_ATTEMPT', 'NOTE'];
export const CHANNELS = ['WHATSAPP', 'CALL', 'EMAIL', 'SMS'];
export const BEST_TIMES = ['MORNING', 'AFTERNOON', 'EVENING', 'ANY'];
export const TONES = ['FORMAL', 'FRIENDLY'];
const LANGUAGES = ['en', 'ar', 'fr', 'ru', 'tr', 'hi', 'ur', 'zh', 'de', 'fa'];
const DAY_MS = 86_400_000;
const STALE_DAYS = 14;

const n = (v) => Number(v || 0);
const minutesBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 60_000;

// Contact preferences an agent records on the lead page. Unknown values are rejected.
export function cleanPreferences({ preferred_channel, best_time, tone, preferred_language } = {}) {
  const out = {};
  const pick = (value, allowed, code) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const v = String(value).trim();
    const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
    if (!hit) throw new HttpError(400, code);
    return hit;
  };
  const c = pick(preferred_channel, CHANNELS, 'INVALID_CHANNEL'); if (c !== undefined) out.preferred_channel = c;
  const b = pick(best_time, BEST_TIMES, 'INVALID_BEST_TIME'); if (b !== undefined) out.best_time = b;
  const t = pick(tone, TONES, 'INVALID_TONE'); if (t !== undefined) out.tone = t;
  const l = pick(preferred_language, LANGUAGES, 'INVALID_LANGUAGE'); if (l !== undefined) out.preferred_language = l;
  return out;
}

function tally(values, allowed) {
  const counts = Object.fromEntries([...allowed, 'NOT_SET'].map((k) => [k, 0]));
  for (const v of values) {
    const k = v && allowed.includes(v) ? v : v ? v : 'NOT_SET';
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

// The whole dashboard for one organization. agentId narrows it to one person's leads
// (an agent's own view, or a manager/owner drilling into one agent).
export function buildDashboard({ orgId, agentId = null, days = 30, includeTeam = true }) {
  const db = getDb();
  const org = db.prepare('SELECT id, name, kind FROM organization WHERE id = ?').get(Number(orgId));
  if (!org) throw new HttpError(404, 'NOT_FOUND');
  const period = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const nowTs = now();
  const nowIso = iso(nowTs);
  const since = iso(new Date(nowTs.getTime() - period * DAY_MS));
  const staleBefore = iso(new Date(nowTs.getTime() - STALE_DAYS * DAY_MS));
  const in7 = iso(new Date(nowTs.getTime() + 7 * DAY_MS));
  const today = dubaiDay(nowTs);

  const leadWhere = agentId ? 'l.org_id = ? AND l.assigned_user_id = ?' : 'l.org_id = ?';
  const leadParams = agentId ? [org.id, Number(agentId)] : [org.id];

  const leads = db.prepare(`SELECT l.id, l.stage, l.source_type, l.priority, l.assigned_user_id, l.deal_value_aed, l.created_at, l.updated_at,
      l.first_contact_due, l.first_contacted_at, c.full_name, c.preferred_channel, c.best_time, c.tone, c.preferred_language
    FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id WHERE ${leadWhere}`).all(...leadParams);
  const leadIds = new Set(leads.map((l) => l.id));

  const tasks = db.prepare(`SELECT t.id, t.lead_id, t.assignee_id, t.title, t.due_at, t.done_at, c.full_name, l.stage, l.source_type, u.name AS assignee_name
    FROM follow_up_task t JOIN crm_lead l ON l.id = t.lead_id JOIN crm_contact c ON c.id = l.contact_id LEFT JOIN platform_user u ON u.id = t.assignee_id
    WHERE ${leadWhere}`).all(...leadParams);

  const activities = db.prepare(`SELECT a.id, a.lead_id, a.user_id, a.type, a.body, a.created_at, a.template_id, u.name AS user_name, c.full_name
    FROM lead_activity a JOIN crm_lead l ON l.id = a.lead_id JOIN crm_contact c ON c.id = l.contact_id LEFT JOIN platform_user u ON u.id = a.user_id
    WHERE ${leadWhere} AND a.created_at >= ? ORDER BY a.created_at DESC`).all(...leadParams, iso(new Date(nowTs.getTime() - Math.max(period, STALE_DAYS) * DAY_MS)));

  // --- KPIs ------------------------------------------------------------------------
  const open = leads.filter((l) => !CLOSED_STAGES.includes(l.stage));
  const won = leads.filter((l) => l.stage === 'CLOSED_WON');
  const lost = leads.filter((l) => l.stage === 'CLOSED_LOST');
  const lastTouch = new Map();
  for (const a of activities) if (!lastTouch.has(a.lead_id) || a.created_at > lastTouch.get(a.lead_id)) lastTouch.set(a.lead_id, a.created_at);
  const openTaskLeads = new Set(tasks.filter((t) => !t.done_at).map((t) => t.lead_id));
  const stale = open.filter((l) => l.stage !== 'NEW' && (lastTouch.get(l.id) || l.updated_at || l.created_at) < staleBefore);
  const noNextStep = open.filter((l) => !openTaskLeads.has(l.id));
  const kpis = {
    total_leads: leads.length,
    open_leads: open.length,
    new_in_period: leads.filter((l) => l.created_at >= since).length,
    won: won.length,
    lost: lost.length,
    win_rate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    pipeline_value_aed: open.reduce((s, l) => s + n(l.deal_value_aed), 0),
    won_value_aed: won.reduce((s, l) => s + n(l.deal_value_aed), 0),
    stale_leads: stale.length,
    open_without_next_step: noNextStep.length,
  };

  // --- Pipeline (every stage, in order) --------------------------------------------
  const pipeline = STAGES.map((stage) => {
    const rows = leads.filter((l) => l.stage === stage);
    return { stage, count: rows.length, value_aed: rows.reduce((s, l) => s + n(l.deal_value_aed), 0) };
  });
  const by_source = Object.entries(leads.reduce((m, l) => ((m[l.source_type] = (m[l.source_type] || 0) + 1), m), {})).map(([source_type, count]) => ({ source_type, count }));

  // --- Follow-ups ------------------------------------------------------------------
  const openTasks = tasks.filter((t) => !t.done_at).sort((a, b) => (a.due_at < b.due_at ? -1 : 1));
  const follow_ups = {
    overdue: openTasks.filter((t) => t.due_at < nowIso).length,
    due_today: openTasks.filter((t) => t.due_at >= nowIso && dubaiDay(new Date(t.due_at)) === today).length,
    next_7_days: openTasks.filter((t) => t.due_at >= nowIso && t.due_at <= in7).length,
    done_in_period: tasks.filter((t) => t.done_at && t.done_at >= since).length,
    done_on_time_in_period: tasks.filter((t) => t.done_at && t.done_at >= since && t.done_at <= t.due_at).length,
    upcoming: openTasks.slice(0, 12).map((t) => ({ id: t.id, lead_id: t.lead_id, title: t.title, due_at: t.due_at, overdue: t.due_at < nowIso, full_name: t.full_name, stage: t.stage, source_type: t.source_type, assignee_name: t.assignee_name })),
    stale: stale.slice(0, 8).map((l) => ({ lead_id: l.id, full_name: l.full_name, stage: l.stage, last_touch: lastTouch.get(l.id) || l.updated_at })),
  };

  // --- First-contact SLA -----------------------------------------------------------
  const withDue = leads.filter((l) => l.first_contact_due);
  const contactTimes = leads.filter((l) => l.first_contacted_at).map((l) => minutesBetween(l.created_at, l.first_contacted_at)).filter((m) => m >= 0);
  const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const mid = Math.floor(s.length / 2); return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2); };
  const sla = {
    met: withDue.filter((l) => l.first_contacted_at && l.first_contacted_at <= l.first_contact_due).length,
    breached: withDue.filter((l) => (l.first_contacted_at && l.first_contacted_at > l.first_contact_due) || (!l.first_contacted_at && l.first_contact_due < nowIso)).length,
    waiting: withDue.filter((l) => !l.first_contacted_at && l.first_contact_due >= nowIso).length,
    median_minutes_to_first_contact: median(contactTimes),
    hot_median_minutes: median(leads.filter((l) => l.source_type === 'HOT' && l.first_contacted_at).map((l) => minutesBetween(l.created_at, l.first_contacted_at)).filter((m) => m >= 0)),
  };

  // --- Team activity (communication volume) ----------------------------------------
  const inPeriod = activities.filter((a) => a.created_at >= since);
  const by_type = Object.fromEntries(OUTREACH_TYPES.map((t) => [t, inPeriod.filter((a) => a.type === t).length]));
  const trendDays = Math.min(period, 14);
  const trend = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const day = dubaiDay(new Date(nowTs.getTime() - i * DAY_MS));
    trend.push({ day, count: inPeriod.filter((a) => OUTREACH_TYPES.includes(a.type) && dubaiDay(new Date(a.created_at)) === day).length });
  }
  const recent = inPeriod.slice(0, 12).map((a) => ({ lead_id: a.lead_id, type: a.type, user_name: a.user_name, full_name: a.full_name, created_at: a.created_at, body: String(a.body || '').slice(0, 140) }));

  // --- How clients like to be contacted + which templates the team uses -------------
  const templates = db.prepare('SELECT id, name, channel, language FROM message_template WHERE org_id = ? ORDER BY channel, language, name').all(org.id);
  const usage = new Map();
  for (const a of inPeriod) if (a.template_id) usage.set(Number(a.template_id), (usage.get(Number(a.template_id)) || 0) + 1);
  const communication = {
    preferred_channel: tally(leads.map((l) => l.preferred_channel), CHANNELS),
    best_time: tally(leads.map((l) => l.best_time), BEST_TIMES),
    tone: tally(leads.map((l) => l.tone), TONES),
    language: tally(leads.map((l) => l.preferred_language), []),
    with_preferences: leads.filter((l) => l.preferred_channel || l.best_time || l.tone).length,
    templates: templates.map((t) => ({ ...t, uses_in_period: usage.get(Number(t.id)) || 0 })),
    templates_by_channel: templates.reduce((m, t) => { const k = `${t.channel}·${t.language}`; m[k] = (m[k] || 0) + 1; return m; }, {}),
  };

  // --- Per-agent table (organization view only) -------------------------------------
  let team = null;
  if (!agentId && includeTeam) {
    const members = db.prepare(`SELECT m.user_id, m.role, u.name, u.email FROM membership m JOIN platform_user u ON u.id = m.user_id
      WHERE m.org_id = ? AND m.status = 'ACTIVE' ORDER BY m.id`).all(org.id);
    team = members.map((m) => {
      const mine = leads.filter((l) => l.assigned_user_id === m.user_id);
      const mineTimes = mine.filter((l) => l.first_contacted_at).map((l) => minutesBetween(l.created_at, l.first_contacted_at)).filter((x) => x >= 0);
      const acts = inPeriod.filter((a) => a.user_id === m.user_id);
      const last = activities.find((a) => a.user_id === m.user_id);
      return {
        user_id: m.user_id, name: m.name, email: m.email, role: m.role,
        leads: mine.length,
        open: mine.filter((l) => !CLOSED_STAGES.includes(l.stage)).length,
        won: mine.filter((l) => l.stage === 'CLOSED_WON').length,
        pipeline_value_aed: mine.filter((l) => !CLOSED_STAGES.includes(l.stage)).reduce((s, l) => s + n(l.deal_value_aed), 0),
        overdue_follow_ups: openTasks.filter((t) => t.due_at < nowIso && (t.assignee_id === m.user_id)).length,
        activities_in_period: acts.length,
        calls: acts.filter((a) => a.type === 'CALL_LOGGED').length,
        whatsapp: acts.filter((a) => a.type === 'WHATSAPP_LOGGED').length,
        emails: acts.filter((a) => a.type === 'EMAIL_LOGGED').length,
        meetings: acts.filter((a) => a.type === 'MEETING' || a.type === 'VIEWING').length,
        median_minutes_to_first_contact: median(mineTimes),
        last_activity_at: last?.created_at || null,
      };
    });
  }
  const unassigned = agentId ? null : open.filter((l) => !l.assigned_user_id).length;

  return {
    org: { id: org.id, name: org.name, kind: org.kind },
    scope: agentId ? 'agent' : 'organization',
    agent_id: agentId ? Number(agentId) : null,
    period_days: period,
    generated_at: nowIso,
    kpis: { ...kpis, unassigned_open: unassigned },
    pipeline, by_source, follow_ups, sla,
    activity: { by_type, trend, recent },
    communication,
    team,
    lead_ids_count: leadIds.size,
  };
}

// What the signed-in organization member may see: managers see the whole organization
// (and may drill into one member); everyone else sees only their own leads.
export function dashboardFor(req, { days, agent } = {}) {
  const orgId = req.membership.org_id;
  if (hasPerm(req, 'crm.all')) {
    if (agent) {
      const m = getDb().prepare("SELECT 1 FROM membership WHERE org_id = ? AND user_id = ? AND status = 'ACTIVE'").get(orgId, Number(agent));
      if (!m) throw new HttpError(404, 'NOT_A_MEMBER');
      return buildDashboard({ orgId, agentId: Number(agent), days });
    }
    return buildDashboard({ orgId, days });
  }
  return buildDashboard({ orgId, agentId: req.user.id, days, includeTeam: false });
}

// --- Platform owner: monitor every agency and solo agent -----------------------------
export function ownerOverview({ days = 30 } = {}) {
  const db = getDb();
  const period = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const nowIso = iso();
  const since = iso(new Date(now().getTime() - period * DAY_MS));
  const orgs = db.prepare(`SELECT o.id, o.name, o.kind, u.email AS owner_email,
      (SELECT COUNT(*) FROM membership m WHERE m.org_id = o.id AND m.status = 'ACTIVE') AS members
    FROM organization o JOIN platform_user u ON u.id = o.owner_user_id ORDER BY o.id`).all();
  const leadRows = db.prepare(`SELECT org_id, stage, deal_value_aed, first_contact_due, first_contacted_at FROM crm_lead`).all();
  const taskRows = db.prepare('SELECT org_id, due_at FROM follow_up_task WHERE done_at IS NULL').all();
  const actRows = db.prepare('SELECT org_id, created_at FROM lead_activity WHERE created_at >= ?').all(since);
  const lastAct = db.prepare('SELECT org_id, MAX(created_at) AS at FROM lead_activity GROUP BY org_id').all();
  const lastByOrg = new Map(lastAct.map((r) => [Number(r.org_id), r.at]));
  const rows = orgs.map((o) => {
    const ls = leadRows.filter((l) => Number(l.org_id) === Number(o.id));
    const openLs = ls.filter((l) => !CLOSED_STAGES.includes(l.stage));
    const won = ls.filter((l) => l.stage === 'CLOSED_WON').length;
    const lost = ls.filter((l) => l.stage === 'CLOSED_LOST').length;
    return {
      ...o, members: n(o.members),
      leads: ls.length, open: openLs.length, won, lost,
      win_rate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
      pipeline_value_aed: openLs.reduce((s, l) => s + n(l.deal_value_aed), 0),
      overdue_follow_ups: taskRows.filter((t) => Number(t.org_id) === Number(o.id) && t.due_at < nowIso).length,
      sla_breached: ls.filter((l) => l.first_contact_due && ((l.first_contacted_at && l.first_contacted_at > l.first_contact_due) || (!l.first_contacted_at && l.first_contact_due < nowIso))).length,
      activities_in_period: actRows.filter((a) => Number(a.org_id) === Number(o.id)).length,
      last_activity_at: lastByOrg.get(Number(o.id)) || null,
    };
  });
  const sum = (k) => rows.reduce((s, r) => s + n(r[k]), 0);
  return {
    period_days: period,
    totals: {
      agencies: rows.filter((r) => r.kind === 'AGENCY').length,
      solo_agents: rows.filter((r) => r.kind === 'AGENT').length,
      leads: sum('leads'), open: sum('open'), won: sum('won'), pipeline_value_aed: sum('pipeline_value_aed'),
      overdue_follow_ups: sum('overdue_follow_ups'), sla_breached: sum('sla_breached'), activities_in_period: sum('activities_in_period'),
    },
    organizations: rows,
  };
}

export function ownerOrgDashboard({ actor, orgId, agent, days }) {
  const d = buildDashboard({ orgId, agentId: agent ? Number(agent) : null, days });
  audit({ actor: actor.id, org: Number(orgId), action: 'OWNER_CRM_DASHBOARD_VIEWED', target: agent ? `user:${agent}` : `org:${orgId}` });
  return d;
}

// Lead list for the owner: contact details masked; opening one lead shows them and is audited.
export function ownerOrgLeads({ orgId, stage, agent, q }) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM organization WHERE id = ?').get(Number(orgId))) throw new HttpError(404, 'NOT_FOUND');
  const where = ['l.org_id = ?'];
  const params = [Number(orgId)];
  if (stage) { if (!STAGES.includes(stage)) throw new HttpError(400, 'INVALID_STAGE'); where.push('l.stage = ?'); params.push(stage); }
  if (agent) { where.push('l.assigned_user_id = ?'); params.push(Number(agent)); }
  if (q) { where.push('lower(c.full_name) LIKE ?'); params.push(`%${String(q).toLowerCase()}%`); }
  const rows = db.prepare(`SELECT l.id, l.stage, l.source_type, l.priority, l.deal_value_aed, l.created_at, l.assigned_user_id, l.first_contacted_at,
      c.full_name, c.email, c.phone, c.preferred_channel, u.name AS assignee_name,
      (SELECT MIN(t.due_at) FROM follow_up_task t WHERE t.lead_id = l.id AND t.done_at IS NULL) AS next_task_due
    FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id LEFT JOIN platform_user u ON u.id = l.assigned_user_id
    WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 500`).all(...params);
  return rows.map((r) => ({ ...r, email: maskEmail(r.email), phone: maskPhone(r.phone), masked: true }));
}

function ownerLoadLead(orgId, leadId) {
  const lead = getDb().prepare(`SELECT l.*, c.full_name, c.email, c.phone, c.nationality, c.preferred_language, c.preferred_channel, c.best_time, c.tone,
      c.marketing_permission, c.suppressed, u.name AS assignee_name
    FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id LEFT JOIN platform_user u ON u.id = l.assigned_user_id
    WHERE l.id = ? AND l.org_id = ?`).get(Number(leadId), Number(orgId));
  if (!lead) throw new HttpError(404, 'NOT_FOUND');
  return lead;
}

export function ownerLeadDetail({ actor, orgId, leadId }) {
  const db = getDb();
  const lead = ownerLoadLead(orgId, leadId);
  audit({ actor: actor.id, org: lead.org_id, action: 'OWNER_CRM_LEAD_OPENED', target: `lead:${lead.id}` });
  return {
    ...lead,
    activities: db.prepare('SELECT a.type, a.body, a.created_at, u.name AS user_name FROM lead_activity a LEFT JOIN platform_user u ON u.id = a.user_id WHERE a.lead_id = ? ORDER BY a.created_at DESC LIMIT 100').all(lead.id),
    tasks: db.prepare('SELECT t.title, t.due_at, t.done_at, u.name AS assignee_name FROM follow_up_task t LEFT JOIN platform_user u ON u.id = t.assignee_id WHERE t.lead_id = ? ORDER BY t.due_at').all(lead.id),
    members: db.prepare("SELECT m.user_id, u.name, m.role FROM membership m JOIN platform_user u ON u.id = m.user_id WHERE m.org_id = ? AND m.status = 'ACTIVE' ORDER BY m.id").all(lead.org_id),
  };
}

// The owner may move a lead to another stage or another member of the SAME organization.
// Every change is written to the lead's timeline (as the owner) and to the audit log.
export function ownerUpdateLead({ actor, orgId, leadId, stage, assigned_user_id }) {
  const db = getDb();
  const lead = ownerLoadLead(orgId, leadId);
  const ts = iso();
  if (stage === undefined && assigned_user_id == null) throw new HttpError(400, 'NOTHING_TO_CHANGE');
  if (stage !== undefined) {
    if (!STAGES.includes(stage)) throw new HttpError(400, 'INVALID_STAGE');
    db.prepare('UPDATE crm_lead SET stage = ?, updated_at = ? WHERE id = ?').run(stage, ts, lead.id);
    db.prepare('INSERT INTO lead_activity (org_id, lead_id, user_id, type, body, created_at) VALUES (?,?,?,?,?,?)').run(lead.org_id, lead.id, actor.id, 'STAGE_CHANGE', `Platform owner: ${lead.stage} → ${stage}`, ts);
  }
  if (assigned_user_id != null) {
    const m = db.prepare("SELECT u.name FROM membership m JOIN platform_user u ON u.id = m.user_id WHERE m.org_id = ? AND m.user_id = ? AND m.status='ACTIVE'").get(lead.org_id, Number(assigned_user_id));
    if (!m) throw new HttpError(400, 'ASSIGNEE_NOT_IN_ORGANIZATION');
    db.prepare('UPDATE crm_lead SET assigned_user_id = ?, updated_at = ? WHERE id = ?').run(Number(assigned_user_id), ts, lead.id);
    db.prepare('INSERT INTO lead_activity (org_id, lead_id, user_id, type, body, created_at) VALUES (?,?,?,?,?,?)').run(lead.org_id, lead.id, actor.id, 'REASSIGNED', `Platform owner assigned this lead to ${m.name}`, ts);
    notify(Number(assigned_user_id), lead.org_id, 'LEAD_ASSIGNED', `Lead assigned to you: ${lead.full_name}`, `#/crm/lead/${lead.id}`);
  }
  audit({ actor: actor.id, org: lead.org_id, action: 'OWNER_CRM_LEAD_UPDATED', target: `lead:${lead.id}`, meta: { stage: stage ?? null, assigned_user_id: assigned_user_id ?? null, previous_stage: lead.stage, previous_assignee: lead.assigned_user_id } });
  return ownerLeadDetail({ actor, orgId, leadId });
}
