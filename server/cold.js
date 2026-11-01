import { getDb, tx } from './db.js';
import { HttpError, iso, now, dubaiDay, audit, notify, flag, maskName, maskEmail, maskPhone } from './util.js';
import { activeSubscription, quotaAccount } from './entitlements.js';

const MAX_PAGE = 50;
const MAX_IDS_PER_REQUEST = 1000;
const MAX_FILTER_TRANSFER = 5000;
export const COLD_LABEL = 'Historical investor record — NOT verified as a new/current inquiry';

// --- Filter validation: the client sends a filter *description*; SQL is built only
// from whitelisted keys and typed values. Free-text name search is deliberately absent
// so masked previews cannot be used to probe identities.
const STRING_FILTERS = {
  country: 't.country', city: 't.city', area: 't.area', property_type: 't.property_type',
  master_developer: 't.master_developer', project: 't.project', nationality: 'ic.nationality',
};
export function parseFilter(input = {}) {
  if (typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'INVALID_FILTER');
  const f = {};
  for (const k of Object.keys(STRING_FILTERS)) {
    const v = input[k];
    if (v == null || v === '') continue;
    const arr = (Array.isArray(v) ? v : [v]).map(String).filter((s) => s.length > 0 && s.length <= 120).slice(0, 25);
    if (arr.length) f[k] = arr;
  }
  if (input.client_role) {
    if (!['BUYER', 'SELLER'].includes(input.client_role)) throw new HttpError(400, 'INVALID_FILTER', 'client_role');
    f.client_role = input.client_role;
  }
  for (const k of ['price_min', 'price_max', 'size_min', 'size_max', 'year_from', 'year_to', 'min_transactions']) {
    if (input[k] == null || input[k] === '') continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'INVALID_FILTER', k);
    f[k] = n;
  }
  for (const k of ['has_email', 'has_phone']) if (input[k] === true || input[k] === 'true') f[k] = true;
  return f;
}

function buildWhere(f) {
  const where = ["ic.rights_status != 'DENIED'"];
  const params = [];
  for (const [k, col] of Object.entries(STRING_FILTERS)) {
    if (!f[k]) continue;
    where.push(`${col} IN (${f[k].map(() => '?').join(',')})`);
    params.push(...f[k]);
  }
  if (f.client_role) { where.push('t.client_role = ?'); params.push(f.client_role); }
  if (f.price_min != null) { where.push('t.price_aed >= ?'); params.push(f.price_min); }
  if (f.price_max != null) { where.push('t.price_aed <= ?'); params.push(f.price_max); }
  if (f.size_min != null) { where.push('t.size_m2 >= ?'); params.push(f.size_min); }
  if (f.size_max != null) { where.push('t.size_m2 <= ?'); params.push(f.size_max); }
  if (f.year_from != null) { where.push("CAST(substr(t.registration_date,1,4) AS INTEGER) >= ?"); params.push(f.year_from); }
  if (f.year_to != null) { where.push("CAST(substr(t.registration_date,1,4) AS INTEGER) <= ?"); params.push(f.year_to); }
  if (f.has_email) where.push('ic.email IS NOT NULL');
  if (f.has_phone) where.push('ic.phone IS NOT NULL');
  const having = f.min_transactions ? `AND total_transactions >= ${Math.floor(f.min_transactions)}` : '';
  return { sql: where.join(' AND '), params, having };
}

// One row per investor: a person with 15 transactions is one contact. The row shows the
// most recent matching transaction (window functions work the same in SQLite and Postgres).
function investorQuery(f) {
  const w = buildWhere(f);
  return {
    sql: `SELECT * FROM (
        SELECT ic.id, ic.full_name, ic.email, ic.phone, ic.nationality, ic.rights_status, ic.suppressed,
          ic.identity_confidence, ic.marketing_permission, ic.quality_score,
          t.registration_date AS last_date, t.client_role, t.country, t.city, t.area, t.property_type,
          t.master_developer, t.project, t.size_m2, t.price_aed,
          COUNT(*) OVER (PARTITION BY ic.id) AS matching_transactions,
          ROW_NUMBER() OVER (PARTITION BY ic.id ORDER BY t.registration_date DESC, t.id DESC) AS row_rank,
          (SELECT COUNT(*) FROM investor_transaction x WHERE x.investor_id = ic.id) AS total_transactions
        FROM investor_contact ic JOIN investor_transaction t ON t.investor_id = ic.id
        WHERE ${w.sql}
      ) ranked WHERE row_rank = 1 ${w.having}`,
    params: w.params,
  };
}

export function eligibility(row, transferEnabled) {
  if (!transferEnabled) return 'TRANSFER_DISABLED_PENDING_LEGAL_APPROVAL';
  if (row.rights_status !== 'APPROVED') return 'RIGHTS_PENDING_REVIEW';
  if (row.suppressed) return 'SUPPRESSED_DO_NOT_CONTACT';
  return null;
}

function presentRow(row, { acquired, ownerView, transferEnabled }) {
  const restricted = row.rights_status !== 'APPROVED';
  return {
    id: row.id,
    // PII is masked server-side for subscribers; restricted records carry no PII at all.
    name: ownerView ? row.full_name : restricted ? null : maskName(row.full_name),
    email: ownerView ? row.email : restricted ? null : maskEmail(row.email),
    phone: ownerView ? row.phone : restricted ? null : maskPhone(row.phone),
    has_email: !!row.email, has_phone: !!row.phone,
    nationality: restricted && !ownerView ? null : row.nationality,
    client_role: row.client_role, country: row.country, city: row.city, area: row.area,
    property_type: row.property_type, master_developer: row.master_developer, project: row.project,
    size_m2: row.size_m2, price_aed: row.price_aed, last_registration_date: row.last_date,
    matching_transactions: row.matching_transactions, total_transactions: row.total_transactions,
    rights_status: row.rights_status, identity_confidence: row.identity_confidence,
    marketing_permission: row.marketing_permission, quality_score: row.quality_score,
    acquired, blocked_reason: acquired ? null : eligibility(row, transferEnabled),
  };
}

export function search({ orgId, filter, cursor, limit = 25, ownerView = false }) {
  const db = getDb();
  const f = parseFilter(filter);
  const q = investorQuery(f);
  const pageSize = Math.min(Math.max(1, Number(limit) || 25), MAX_PAGE);
  let outer = `SELECT * FROM (${q.sql}) r`;
  const params = [...q.params];
  if (cursor) {
    const [d, id] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    outer += ' WHERE (r.last_date, r.id) < (?, ?)';
    params.push(d, Number(id));
  }
  outer += ' ORDER BY r.last_date DESC, r.id DESC LIMIT ?';
  const rows = db.prepare(outer).all(...params, pageSize + 1);
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  const acquiredSet = orgId ? acquiredIds(orgId, page.map((r) => r.id)) : new Set();
  const transferEnabled = flag('COLD_SUBSCRIBER_TRANSFER');
  const counts = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN r.rights_status='APPROVED' AND r.suppressed=0 THEN 1 ELSE 0 END) AS eligible,
      SUM(CASE WHEN r.rights_status!='APPROVED' OR r.suppressed=1 THEN 1 ELSE 0 END) AS restricted,
      SUM(CASE WHEN g.investor_id IS NOT NULL THEN 1 ELSE 0 END) AS acquired
    FROM (${q.sql}) r LEFT JOIN record_acquisition_grant g ON g.investor_id = r.id AND g.org_id = ?`).get(...q.params, orgId ?? -1);
  const last = page[page.length - 1];
  return {
    filter: f,
    counts: { total: counts.total, eligible: counts.eligible ?? 0, restricted: counts.restricted ?? 0, already_acquired: counts.acquired ?? 0 },
    transfer_enabled: transferEnabled,
    results: page.map((r) => presentRow(r, { acquired: acquiredSet.has(r.id), ownerView, transferEnabled })),
    next_cursor: hasMore ? Buffer.from(`${last.last_date}|${last.id}`).toString('base64url') : null,
  };
}

function acquiredIds(orgId, ids, conn = getDb()) {
  if (!ids.length) return new Set();
  return new Set(conn.prepare(`SELECT investor_id FROM record_acquisition_grant WHERE org_id = ? AND investor_id IN (${ids.map(() => '?').join(',')})`)
    .all(orgId, ...ids).map((r) => r.investor_id));
}

export function filterOptions() {
  const db = getDb();
  const distinct = (col, tbl = 'investor_transaction') => db.prepare(`SELECT DISTINCT ${col} AS v FROM ${tbl} WHERE ${col} IS NOT NULL ORDER BY 1`).all().map((r) => r.v);
  return {
    country: distinct('country'), city: distinct('city'), area: distinct('area'), property_type: distinct('property_type'),
    master_developer: distinct('master_developer'), project: distinct('project'), nationality: distinct('nationality', 'investor_contact'),
    client_role: ['BUYER', 'SELLER'],
    coverage_note: 'Fields shown are the fields present in the platform dataset. Unknown values are not imputed.',
  };
}

// --- Selection resolution: ids come from the client but every id is re-checked against
// the database; for "all matching filter" the server re-runs the validated filter.
function resolveSelection(conn, selection) {
  if (selection?.mode === 'ids') {
    const ids = [...new Set((selection.ids || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw new HttpError(400, 'EMPTY_SELECTION');
    if (ids.length > MAX_IDS_PER_REQUEST) throw new HttpError(400, 'SELECTION_TOO_LARGE', `Max ${MAX_IDS_PER_REQUEST} ids per request`);
    const found = conn.prepare(`SELECT id, full_name, email, phone, nationality, rights_status, suppressed, marketing_permission, provenance_id
      FROM investor_contact WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const byId = new Map(found.map((r) => [r.id, r]));
    return { requested: (selection.ids || []).length, rows: ids.map((id) => byId.get(id) || { id, missing: true }) };
  }
  if (selection?.mode === 'filter') {
    const q = investorQuery(parseFilter(selection.filter));
    const rows = conn.prepare(`SELECT r.id, ic.full_name, ic.email, ic.phone, ic.nationality, ic.rights_status, ic.suppressed, ic.marketing_permission, ic.provenance_id
      FROM (${q.sql}) r JOIN investor_contact ic ON ic.id = r.id ORDER BY r.last_date DESC, r.id DESC LIMIT ?`).all(...q.params, MAX_FILTER_TRANSFER + 1);
    if (rows.length > MAX_FILTER_TRANSFER) throw new HttpError(400, 'SELECTION_TOO_LARGE', `Narrow the filter to at most ${MAX_FILTER_TRANSFER} investors`);
    return { requested: rows.length, rows };
  }
  throw new HttpError(400, 'INVALID_SELECTION');
}

function classify(conn, orgId, rows) {
  const transferEnabled = flag('COLD_SUBSCRIBER_TRANSFER');
  const acquired = acquiredIds(orgId, rows.filter((r) => !r.missing).map((r) => r.id), conn);
  const out = { newRecords: [], already: [], blocked: [] };
  for (const r of rows) {
    if (r.missing) { out.blocked.push({ id: r.id, reason: 'NOT_FOUND' }); continue; }
    if (acquired.has(r.id)) { out.already.push(r); continue; }
    const reason = eligibility(r, transferEnabled);
    if (reason) out.blocked.push({ id: r.id, reason });
    else out.newRecords.push(r);
  }
  return out;
}

// A member's own daily cap inside the account's shared pool (set by the agency director).
// The account limit (999 Agency / 99 Agent) is always the outer limit.
export function userQuota(orgId, userId, conn = getDb(), day = dubaiDay()) {
  const m = conn.prepare("SELECT daily_cap FROM membership WHERE org_id = ? AND user_id = ? AND status = 'ACTIVE'").get(orgId, userId);
  const used = conn.prepare('SELECT COALESCE(SUM(delta),0) AS n FROM quota_ledger WHERE org_id = ? AND local_day = ? AND user_id = ?').get(orgId, day, userId).n;
  const cap = m?.daily_cap ?? null;
  return { cap, used, remaining: cap == null ? null : Math.max(0, cap - used) };
}

// What this user can still transfer today: the smaller of the shared pool and their cap.
function allowanceFor(quota, mine) {
  return mine.remaining == null ? quota.remaining : Math.min(quota.remaining, mine.remaining);
}

export function estimate({ orgId, userId, selection }) {
  const db = getDb();
  const sub = activeSubscription(orgId);
  const { requested, rows } = resolveSelection(db, selection);
  const c = classify(db, orgId, rows);
  const quota = sub ? quotaAccount(orgId, sub) : null;
  const mine = userId ? userQuota(orgId, userId) : { cap: null, used: 0, remaining: null };
  const remaining = quota ? allowanceFor(quota, mine) : 0;
  return {
    entitled: !!sub,
    selected: requested,
    distinct_selected: rows.length,
    duplicates_in_request: requested - rows.length,
    already_acquired: c.already.length,
    new_chargeable: c.newRecords.length,
    blocked: c.blocked.length,
    blocked_reasons: tally(c.blocked.map((b) => b.reason)),
    deliverable_now: sub ? Math.min(c.newRecords.length, remaining) : 0,
    quota: quota && { day: quota.local_day, limit: quota.plan_limit, used: quota.committed_used, remaining, account_remaining: quota.remaining, resets_at: quota.resets_at, timezone: quota.timezone, my_cap: mine.cap, my_used: mine.used },
  };
}

const tally = (arr) => arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});

function pickAssignee(conn, orgId, initiator, assignTo) {
  if (assignTo === 'ROUND_ROBIN') {
    const agents = conn.prepare("SELECT user_id FROM membership WHERE org_id = ? AND role = 'AGENT' AND status='ACTIVE' ORDER BY user_id").all(orgId);
    if (!agents.length) return () => initiator.user_id;
    const start = conn.prepare('SELECT COUNT(*) AS n FROM crm_lead WHERE org_id = ?').get(orgId).n;
    let i = start;
    return () => agents[i++ % agents.length].user_id;
  }
  if (assignTo != null && assignTo !== '') {
    if (initiator.role === 'AGENT' && Number(assignTo) !== initiator.user_id) throw new HttpError(403, 'AGENT_CANNOT_ASSIGN_OTHERS');
    const m = conn.prepare("SELECT user_id FROM membership WHERE org_id = ? AND user_id = ? AND status='ACTIVE'").get(orgId, Number(assignTo));
    if (!m) throw new HttpError(400, 'ASSIGNEE_NOT_IN_ORGANIZATION');
    return () => m.user_id;
  }
  return () => initiator.user_id;
}

// The atomic Cold → CRM transfer. One write transaction covers: idempotency check,
// quota read, grants (unique per org+investor), CRM upsert, task, notification,
// ledger and quota commit. Either everything lands or nothing is charged.
export function transfer({ membership, selection, idempotencyKey, allowPartial = false, assignTo, campaignTag }) {
  if (!idempotencyKey || !/^[\w-]{8,100}$/.test(idempotencyKey)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED');
  const orgId = membership.org_id;
  const userId = membership.user_id;
  return tx((conn) => {
    const prior = conn.prepare('SELECT * FROM cold_transfer_job WHERE org_id = ? AND idempotency_key = ?').get(orgId, idempotencyKey);
    if (prior) return jobResult(conn, prior.id, true);

    if (!flag('COLD_SUBSCRIBER_TRANSFER')) throw new HttpError(403, 'TRANSFER_DISABLED_PENDING_LEGAL_APPROVAL');
    const sub = activeSubscription(orgId);
    if (!sub) throw new HttpError(402, 'NO_ACTIVE_COLD_SUBSCRIPTION');

    const { requested, rows } = resolveSelection(conn, selection);
    const c = classify(conn, orgId, rows);
    const quota = quotaAccount(orgId, sub, conn);
    const mine = userQuota(orgId, userId, conn, quota.local_day);
    const allowance = allowanceFor(quota, mine);
    const capLimited = allowance < quota.remaining;
    if (c.newRecords.length > allowance && !allowPartial) {
      throw new HttpError(409, capLimited ? 'USER_DAILY_CAP' : 'INSUFFICIENT_QUOTA', capLimited
        ? `Your personal daily limit is ${mine.cap} records (${mine.remaining} left today). Ask your agency director to raise it, or reduce the selection.`
        : 'Not enough Cold allowance remaining today. Confirm a partial transfer or reduce the selection.', {
        new_chargeable: c.newRecords.length, remaining: allowance, account_remaining: quota.remaining, my_cap: mine.cap, resets_at: quota.resets_at,
      });
    }
    const accepted = c.newRecords.slice(0, allowance);
    const overQuota = c.newRecords.slice(allowance);
    const day = quota.local_day;
    const ts = iso();
    const job = conn.prepare(`INSERT INTO cold_transfer_job (org_id, user_id, idempotency_key, mode, filter_json, assign_to, campaign_tag,
        requested, plan_code, local_day, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(orgId, userId, idempotencyKey, selection.mode, selection.mode === 'filter' ? JSON.stringify(parseFilter(selection.filter)) : null,
        typeof assignTo === 'number' ? assignTo : null, campaignTag ?? null, requested, sub.plan_code, day, 'RUNNING', ts);
    const jobId = Number(job.lastInsertRowid);
    const nextAssignee = pickAssignee(conn, orgId, membership, assignTo);
    const org = conn.prepare('SELECT * FROM organization WHERE id = ?').get(orgId);
    const dueAt = new Date(now().getTime() + org.first_contact_sla_minutes_cold * 60_000).toISOString();
    const item = conn.prepare('INSERT INTO cold_transfer_item (job_id, investor_id, outcome, reason, charged, crm_lead_id) VALUES (?,?,?,?,?,?)');

    for (const r of accepted) {
      // The unique PK on record_acquisition_grant is the last line of defence against double charge.
      conn.prepare('INSERT INTO record_acquisition_grant (org_id, investor_id, job_id, granted_by, local_day, granted_at) VALUES (?,?,?,?,?,?)')
        .run(orgId, r.id, jobId, userId, day, ts);
      const leadId = upsertColdIntoCrm(conn, { orgId, investor: r, assignee: nextAssignee(), dueAt, campaignTag, jobId, userId });
      conn.prepare('INSERT INTO quota_ledger (org_id, local_day, investor_id, job_id, user_id, delta, reason, created_at) VALUES (?,?,?,?,?,1,?,?)')
        .run(orgId, day, r.id, jobId, userId, 'COLD_TRANSFER_CHARGE', ts);
      item.run(jobId, r.id, 'TRANSFERRED', null, 1, leadId);
    }
    for (const r of c.already) {
      const lead = conn.prepare('SELECT l.id FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id WHERE c.org_id = ? AND c.investor_id = ? ORDER BY l.id LIMIT 1').get(orgId, r.id);
      item.run(jobId, r.id, 'ALREADY_ACQUIRED', 'NO_CHARGE_ALREADY_IN_CRM', 0, lead?.id ?? null);
    }
    for (const b of c.blocked) item.run(jobId, b.id, 'REJECTED', b.reason, 0, null);
    for (const r of overQuota) item.run(jobId, r.id, 'REJECTED', capLimited ? 'USER_DAILY_CAP_REACHED' : 'DAILY_QUOTA_EXHAUSTED', 0, null);

    conn.prepare('UPDATE daily_quota_account SET committed_used = committed_used + ? WHERE org_id = ? AND local_day = ?').run(accepted.length, orgId, day);
    conn.prepare('UPDATE cold_transfer_job SET accepted = ?, already_acquired = ?, rejected = ?, charged = ?, status = ? WHERE id = ?')
      .run(accepted.length, c.already.length, c.blocked.length + overQuota.length, accepted.length, 'COMPLETED', jobId);
    conn.prepare('INSERT INTO audit_log (at, actor_user_id, org_id, action, target, meta_json) VALUES (?,?,?,?,?,?)')
      .run(ts, userId, orgId, 'COLD_TRANSFER', `job:${jobId}`, JSON.stringify({
        mode: selection.mode, filter: selection.mode === 'filter' ? parseFilter(selection.filter) : undefined,
        requested, charged: accepted.length, already: c.already.length, rejected: c.blocked.length + overQuota.length, plan: sub.plan_code, day,
      }));
    return jobResult(conn, jobId, false);
  });
}

function upsertColdIntoCrm(conn, { orgId, investor, assignee, dueAt, campaignTag, jobId, userId }) {
  const ts = iso();
  const txns = conn.prepare(`SELECT source_txn_id, client_role, city, area, property_type, master_developer, project, size_m2, price_aed, registration_date
    FROM investor_transaction WHERE investor_id = ? ORDER BY registration_date`).all(investor.id);
  // Never overwrite an existing (possibly fresher, verified) CRM profile with historical
  // data: if the tenant already holds this exact email, link the investor history only.
  let contact = investor.email
    ? conn.prepare('SELECT * FROM crm_contact WHERE org_id = ? AND lower(email) = lower(?) AND investor_id IS NULL').get(orgId, investor.email)
    : null;
  if (contact) {
    conn.prepare('UPDATE crm_contact SET investor_id = ?, updated_at = ? WHERE id = ?').run(investor.id, ts, contact.id);
  } else {
    contact = { id: Number(conn.prepare(`INSERT INTO crm_contact (org_id, full_name, email, phone, nationality, source_type, investor_id, marketing_permission, suppressed, created_at, updated_at)
      VALUES (?,?,?,?,?,'COLD',?,?,?,?,?)`).run(orgId, investor.full_name, investor.email, investor.phone, investor.nationality, investor.id,
      investor.marketing_permission, investor.suppressed, ts, ts).lastInsertRowid) };
  }
  const leadId = Number(conn.prepare(`INSERT INTO crm_lead (org_id, contact_id, source_type, source_detail, provenance_note, stage, assigned_user_id,
      interest_json, campaign_tag, first_contact_due, created_at, updated_at) VALUES (?,?,'COLD','COLD_AI_HOME_HISTORY',?, 'NEW', ?, ?, ?, ?, ?, ?)`)
    .run(orgId, contact.id, COLD_LABEL, assignee, JSON.stringify({ historical_transactions: txns }), campaignTag ?? null, dueAt, ts, ts).lastInsertRowid);
  conn.prepare('INSERT INTO lead_activity (org_id, lead_id, user_id, type, body, created_at) VALUES (?,?,?,?,?,?)')
    .run(orgId, leadId, userId, 'COLD_TRANSFER', `Transferred from the ai-home.world investor history (job ${jobId}). ${txns.length} historical transaction(s) linked.`, ts);
  const title = investor.marketing_permission === 'GRANTED'
    ? 'Follow up historical investor (marketing permission on record)'
    : 'Review historical record & establish lawful basis before any outreach';
  conn.prepare('INSERT INTO follow_up_task (org_id, lead_id, assignee_id, title, due_at, created_at) VALUES (?,?,?,?,?,?)').run(orgId, leadId, assignee, title, dueAt, ts);
  conn.prepare('INSERT INTO notification (user_id, org_id, type, body, link, created_at) VALUES (?,?,?,?,?,?)')
    .run(assignee, orgId, 'COLD_LEAD_ASSIGNED', `Historical investor assigned to you: ${investor.full_name}`, `#/crm/lead/${leadId}`, ts);
  return leadId;
}

export function jobResult(conn, jobId, replay) {
  const job = conn.prepare('SELECT * FROM cold_transfer_job WHERE id = ?').get(jobId);
  const items = conn.prepare('SELECT investor_id, outcome, reason, charged, crm_lead_id FROM cold_transfer_item WHERE job_id = ? ORDER BY investor_id').all(jobId);
  const sub = activeSubscription(job.org_id);
  const quota = sub ? quotaAccount(job.org_id, sub, conn) : null;
  return {
    job_id: job.id, status: job.status, idempotent_replay: replay,
    requested: job.requested, accepted: job.accepted, already_acquired: job.already_acquired, rejected: job.rejected, charged: replay ? 0 : job.charged,
    items: items.map((i) => ({ ...i, crm_link: i.crm_lead_id ? `#/crm/lead/${i.crm_lead_id}` : null })),
    quota: quota && { day: quota.local_day, limit: quota.plan_limit, used: quota.committed_used, remaining: quota.remaining, resets_at: quota.resets_at },
  };
}

export function getJob(orgId, jobId) {
  const conn = getDb();
  const job = conn.prepare('SELECT id FROM cold_transfer_job WHERE id = ? AND org_id = ?').get(Number(jobId), orgId);
  if (!job) throw new HttpError(404, 'NOT_FOUND');
  return jobResult(conn, job.id, false);
}

export function usage(orgId, day = dubaiDay()) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM daily_quota_account WHERE org_id = ? AND local_day = ?').get(orgId, day);
  const byUser = db.prepare(`SELECT u.name, l.user_id, SUM(l.delta) AS transferred FROM quota_ledger l JOIN platform_user u ON u.id = l.user_id
    WHERE l.org_id = ? AND l.local_day = ? GROUP BY l.user_id, u.name ORDER BY transferred DESC`).all(orgId, day);
  const calendar = db.prepare('SELECT local_day, plan_limit, committed_used FROM daily_quota_account WHERE org_id = ? ORDER BY local_day DESC LIMIT 35').all(orgId);
  const jobs = db.prepare(`SELECT j.id, j.created_at, j.mode, j.requested, j.accepted, j.already_acquired, j.rejected, j.charged, u.name AS user_name
    FROM cold_transfer_job j JOIN platform_user u ON u.id = j.user_id WHERE j.org_id = ? ORDER BY j.id DESC LIMIT 25`).all(orgId);
  return { day, timezone: 'Asia/Dubai', limit: row?.plan_limit ?? null, used: row?.committed_used ?? 0, by_user: byUser, calendar, recent_jobs: jobs };
}

export function acquiredList(orgId) {
  return getDb().prepare(`SELECT g.investor_id, g.granted_at, u.name AS granted_by, c.id AS contact_id, c.full_name, c.marketing_permission,
      (SELECT l.id FROM crm_lead l WHERE l.contact_id = c.id ORDER BY l.id LIMIT 1) AS lead_id,
      (SELECT COUNT(*) FROM investor_transaction t WHERE t.investor_id = g.investor_id) AS transactions
    FROM record_acquisition_grant g JOIN platform_user u ON u.id = g.granted_by
    LEFT JOIN crm_contact c ON c.org_id = g.org_id AND c.investor_id = g.investor_id
    WHERE g.org_id = ? ORDER BY g.granted_at DESC LIMIT 500`).all(orgId);
}

// --- Owner's own follow-up CRM -------------------------------------------------------------
// The platform owner can send Master Cold database records straight into their own company
// CRM ("AI-DATA owner CRM"). It is not a subscriber: no subscription, no daily allowance, no
// charge. Opted-out (suppressed) records are skipped; every transfer is a logged job.
export const OWNER_CRM_NAME = 'AI-DATA owner CRM';
const MAX_OWNER_IDS = 500;

export function ownerCrmOrg(conn, userId) {
  const found = conn.prepare(`SELECT o.id FROM organization o JOIN membership m ON m.org_id = o.id AND m.user_id = o.owner_user_id
    WHERE o.owner_user_id = ? AND o.name = ? AND m.status = 'ACTIVE' ORDER BY o.id LIMIT 1`).get(userId, OWNER_CRM_NAME);
  if (found) return found.id;
  const ts = iso();
  const id = Number(conn.prepare("INSERT INTO organization (name, kind, owner_user_id, language, timezone, terms_accepted_at, created_at) VALUES (?, 'AGENCY', ?, 'en', 'Asia/Dubai', ?, ?)")
    .run(OWNER_CRM_NAME, userId, ts, ts).lastInsertRowid);
  conn.prepare("INSERT INTO membership (org_id, user_id, role, created_at) VALUES (?,?,'ORG_OWNER',?)").run(id, userId, ts);
  audit({ actor: userId, org: id, action: 'OWNER_CRM_CREATED' });
  return id;
}

export function ownerToCrm({ actor, ids }) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
  if (!list.length) throw new HttpError(400, 'EMPTY_SELECTION', 'Tick at least one record.');
  if (list.length > MAX_OWNER_IDS) throw new HttpError(400, 'SELECTION_TOO_LARGE', `Send at most ${MAX_OWNER_IDS} records at a time.`);
  return tx((conn) => {
    const orgId = ownerCrmOrg(conn, actor.id);
    const ts = iso();
    const day = dubaiDay();
    const jobId = Number(conn.prepare(`INSERT INTO cold_transfer_job (org_id, user_id, idempotency_key, mode, requested, plan_code, local_day, status, created_at)
      VALUES (?,?,?,'ids',?,'OWNER_CRM',?,'RUNNING',?)`).run(orgId, actor.id, `owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, list.length, day, ts).lastInsertRowid);
    const org = conn.prepare('SELECT first_contact_sla_minutes_cold FROM organization WHERE id = ?').get(orgId);
    const dueAt = new Date(now().getTime() + org.first_contact_sla_minutes_cold * 60_000).toISOString();
    const item = conn.prepare('INSERT INTO cold_transfer_item (job_id, investor_id, outcome, reason, charged, crm_lead_id) VALUES (?,?,?,?,0,?)');
    const counts = { added: 0, already: 0, skipped: 0 };
    for (const id of list) {
      const inv = conn.prepare('SELECT id, full_name, email, phone, nationality, suppressed, marketing_permission FROM investor_contact WHERE id = ?').get(id);
      if (!inv) { item.run(jobId, id, 'REJECTED', 'NOT_FOUND', null); counts.skipped++; continue; }
      if (inv.suppressed) { item.run(jobId, id, 'REJECTED', 'SUPPRESSED_DO_NOT_CONTACT', null); counts.skipped++; continue; }
      if (conn.prepare('SELECT 1 FROM record_acquisition_grant WHERE org_id = ? AND investor_id = ?').get(orgId, id)) {
        item.run(jobId, id, 'ALREADY_ACQUIRED', null, null); counts.already++; continue;
      }
      conn.prepare('INSERT INTO record_acquisition_grant (org_id, investor_id, job_id, granted_by, local_day, granted_at) VALUES (?,?,?,?,?,?)').run(orgId, id, jobId, actor.id, day, ts);
      const leadId = upsertColdIntoCrm(conn, { orgId, investor: inv, assignee: actor.id, dueAt, campaignTag: 'owner-follow-up', jobId, userId: actor.id });
      item.run(jobId, id, 'TRANSFERRED', null, leadId); counts.added++;
    }
    conn.prepare("UPDATE cold_transfer_job SET accepted = ?, already_acquired = ?, rejected = ?, status = 'COMPLETED' WHERE id = ?")
      .run(counts.added, counts.already, counts.skipped, jobId);
    audit({ actor: actor.id, org: orgId, action: 'OWNER_COLD_TO_CRM', target: `job:${jobId}`, meta: counts });
    return { org_id: orgId, job_id: jobId, ...counts };
  });
}
