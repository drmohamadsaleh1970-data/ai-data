import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';
import { HttpError, iso, audit, randomToken } from './util.js';
import { parseFilter } from './cold.js';
import { activeSubscription } from './entitlements.js';

const EXPORT_DIR = path.resolve(process.env.EXPORT_DIR || 'data/exports');
export const EXPORT_FIELDS = {
  investor_id: 'ic.id', full_name: 'ic.full_name', email: 'ic.email', phone: 'ic.phone', nationality: 'ic.nationality',
  rights_status: 'ic.rights_status', marketing_permission: 'ic.marketing_permission', source_txn_id: 't.source_txn_id', client_role: 't.client_role',
  country: 't.country', city: 't.city', area: 't.area', property_type: 't.property_type', master_developer: 't.master_developer',
  project: 't.project', size_m2: 't.size_m2', price_aed: 't.price_aed', registration_date: 't.registration_date', provenance: 'p.source_name',
};

// Owner-only XLSX export. Streams rows to disk with exceljs' streaming writer so large
// exports don't load into memory, and stamps a watermark + manifest sheet.
export async function createOwnerExport({ user, filter, fields }) {
  const f = parseFilter(filter);
  const cols = (Array.isArray(fields) && fields.length ? fields : Object.keys(EXPORT_FIELDS)).filter((k) => EXPORT_FIELDS[k]);
  if (!cols.length) throw new HttpError(400, 'NO_FIELDS');
  const db = getDb();
  const jobId = Number(db.prepare("INSERT INTO owner_export_job (user_id, filter_json, fields_json, status, created_at) VALUES (?,?,?,'RUNNING',?)")
    .run(user.id, JSON.stringify(f), JSON.stringify(cols), iso()).lastInsertRowid);
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const fileName = `owner-export-${jobId}-${randomToken(9)}.xlsx`;
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path.join(EXPORT_DIR, fileName) });
  const ws = wb.addWorksheet('Transactions');
  ws.addRow([`CONFIDENTIAL — AI-DATA owner export #${jobId} — ${user.email} — ${iso()}`]).commit();
  ws.addRow(cols).commit();
  const where = ['1=1'];
  const params = [];
  const map = { country: 't.country', city: 't.city', area: 't.area', property_type: 't.property_type', master_developer: 't.master_developer', project: 't.project', nationality: 'ic.nationality' };
  for (const [k, col] of Object.entries(map)) if (f[k]) { where.push(`${col} IN (${f[k].map(() => '?').join(',')})`); params.push(...f[k]); }
  if (f.client_role) { where.push('t.client_role = ?'); params.push(f.client_role); }
  if (f.price_min != null) { where.push('t.price_aed >= ?'); params.push(f.price_min); }
  if (f.price_max != null) { where.push('t.price_aed <= ?'); params.push(f.price_max); }
  if (f.year_from != null) { where.push('CAST(substr(t.registration_date,1,4) AS INTEGER) >= ?'); params.push(f.year_from); }
  if (f.year_to != null) { where.push('CAST(substr(t.registration_date,1,4) AS INTEGER) <= ?'); params.push(f.year_to); }
  const stmt = db.prepare(`SELECT ${cols.map((c) => `${EXPORT_FIELDS[c]} AS ${c}`).join(', ')} FROM investor_transaction t
    JOIN investor_contact ic ON ic.id = t.investor_id JOIN data_provenance p ON p.id = t.provenance_id WHERE ${where.join(' AND ')} ORDER BY t.registration_date DESC`);
  let count = 0;
  for (const row of stmt.iterate(...params)) { ws.addRow(cols.map((c) => row[c])).commit(); count++; }
  ws.commit();
  const manifest = wb.addWorksheet('Manifest');
  [['Export job', jobId], ['Exported by', user.email], ['Exported at', iso()], ['Rows', count], ['Filter', JSON.stringify(f)], ['Fields', cols.join(', ')],
    ['Notice', 'Contains personal data. Handle under AI-DATA data-protection policy. Do not redistribute.']].forEach((r) => manifest.addRow(r).commit());
  manifest.commit();
  await wb.commit();
  db.prepare("UPDATE owner_export_job SET status = 'COMPLETED', row_count = ?, file_name = ? WHERE id = ?").run(count, fileName, jobId);
  audit({ actor: user.id, action: 'OWNER_XLSX_EXPORT', target: `export:${jobId}`, meta: { rows: count, filter: f, fields: cols } });
  return { job_id: jobId, rows: count, status: 'COMPLETED' };
}

export function exportFile(jobId, user) {
  const job = getDb().prepare('SELECT * FROM owner_export_job WHERE id = ?').get(Number(jobId));
  if (!job || job.status !== 'COMPLETED') throw new HttpError(404, 'NOT_FOUND');
  audit({ actor: user.id, action: 'OWNER_XLSX_DOWNLOAD', target: `export:${job.id}` });
  return { file: path.join(EXPORT_DIR, job.file_name), name: `ai-data-investors-${job.id}.xlsx` };
}

export function dashboard() {
  const db = getDb();
  const orgs = db.prepare('SELECT o.id, o.name, o.kind, o.created_at, u.email AS owner_email, (SELECT COUNT(*) FROM membership m WHERE m.org_id = o.id AND m.status=\'ACTIVE\') AS members FROM organization o JOIN platform_user u ON u.id = o.owner_user_id ORDER BY o.id').all();
  const withSub = orgs.map((o) => {
    const s = activeSubscription(o.id);
    const latest = db.prepare('SELECT status, plan_code, provider, current_period_end FROM subscription WHERE org_id = ? ORDER BY id DESC LIMIT 1').get(o.id);
    return { ...o, active_plan: s?.plan_code ?? null, provider: s?.provider ?? latest?.provider ?? null, status: s ? s.status : latest?.status ?? 'NO_SUBSCRIPTION', renews_or_ends: s?.current_period_end ?? null };
  });
  const active = withSub.filter((o) => o.active_plan);
  const plans = db.prepare('SELECT code, price_usd_cents FROM subscription_plan').all();
  const price = Object.fromEntries(plans.map((p) => [p.code, p.price_usd_cents]));
  const month = iso().slice(0, 7);
  const revenue = db.prepare(`SELECT provider, kind, SUM(CASE WHEN status='COMPLETED' THEN amount_cents ELSE 0 END) AS collected,
      SUM(CASE WHEN status IN ('REFUNDED','REVERSED') THEN amount_cents ELSE 0 END) AS refunded, COUNT(*) AS n FROM payment WHERE substr(paid_at,1,7) = ? GROUP BY provider, kind`).all(month);
  return {
    mrr_cents: active.reduce((s, o) => s + (price[o.active_plan] || 0), 0),
    mrr_basis: 'Sum of list prices of organizations with a verified active entitlement (PayPal webhook or verified cash).',
    active_by_plan: active.reduce((m, o) => ((m[o.active_plan] = (m[o.active_plan] || 0) + 1), m), {}),
    revenue_this_month: revenue,
    hot_revenue_this_month: db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS leads FROM hot_lead_billing_ledger WHERE substr(created_at,1,7) = ?").get(month),
    overdue: withSub.filter((o) => ['PAST_DUE', 'SUSPENDED'].includes(o.status)),
    organizations: withSub,
    pending_cash: db.prepare("SELECT c.*, o.name AS org_name, u.email AS requested_by_email FROM cash_payment_request c JOIN organization o ON o.id = c.org_id JOIN platform_user u ON u.id = c.requested_by WHERE c.status = 'PENDING_PAYMENT' ORDER BY c.id").all(),
    awaiting_activation: db.prepare("SELECT s.id, s.plan_code, s.created_at, o.name AS org_name FROM subscription s JOIN organization o ON o.id = s.org_id WHERE s.status = 'AWAITING_ACTIVATION'").all(),
    cold_usage_today: db.prepare('SELECT o.name, q.local_day, q.plan_limit, q.committed_used FROM daily_quota_account q JOIN organization o ON o.id = q.org_id ORDER BY q.local_day DESC, q.committed_used DESC LIMIT 30').all(),
    data: db.prepare("SELECT COUNT(*) AS investors, SUM(rights_status='APPROVED') AS approved, SUM(rights_status='RESTRICTED_PENDING_REVIEW') AS pending, SUM(suppressed) AS suppressed, (SELECT COUNT(*) FROM investor_transaction) AS transactions FROM investor_contact").get(),
    exports: db.prepare('SELECT e.id, e.row_count, e.status, e.created_at, u.email FROM owner_export_job e JOIN platform_user u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 20').all(),
  };
}

export function provenanceList() {
  return getDb().prepare('SELECT p.*, (SELECT COUNT(*) FROM investor_contact c WHERE c.provenance_id = p.id) AS records FROM data_provenance p').all();
}

// Rights review: approving a source releases its records for PII display/transfer.
export function reviewProvenance({ actor, id, allowTransfer }) {
  const db = getDb();
  db.prepare('UPDATE data_provenance SET allows_subscriber_transfer = ?, allows_pii_display = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
    .run(allowTransfer ? 1 : 0, allowTransfer ? 1 : 0, actor.id, iso(), Number(id));
  db.prepare("UPDATE investor_contact SET rights_status = ?, updated_at = ? WHERE provenance_id = ? AND rights_status != 'DENIED'")
    .run(allowTransfer ? 'APPROVED' : 'RESTRICTED_PENDING_REVIEW', iso(), Number(id));
  audit({ actor: actor.id, action: 'PROVENANCE_REVIEWED', target: `provenance:${id}`, meta: { allowTransfer } });
}

// Data-subject opt-out: suppress at source and propagate to every tenant copy.
export function suppressInvestor({ actor, investorId, reason }) {
  const db = getDb();
  db.prepare('UPDATE investor_contact SET suppressed = 1, marketing_permission = \'DENIED\', updated_at = ? WHERE id = ?').run(iso(), Number(investorId));
  const copies = db.prepare("UPDATE crm_contact SET suppressed = 1, marketing_permission = 'DENIED', updated_at = ? WHERE investor_id = ?").run(iso(), Number(investorId));
  audit({ actor: actor.id, action: 'SUBJECT_SUPPRESSED', target: `investor:${investorId}`, meta: { reason, propagated_to: copies.changes } });
  return { propagated_to: copies.changes };
}

export function setFlag({ actor, key, enabled }) {
  const allowed = ['COLD_SUBSCRIBER_TRANSFER'];
  if (!allowed.includes(key)) throw new HttpError(400, 'UNKNOWN_FLAG');
  getDb().prepare('INSERT INTO feature_flag (key, enabled, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .run(key, enabled ? 1 : 0, actor.id, iso());
  audit({ actor: actor.id, action: 'FEATURE_FLAG_CHANGED', target: key, meta: { enabled } });
}

export function auditLog({ limit = 200, action } = {}) {
  const where = action ? 'WHERE a.action = ?' : '';
  return getDb().prepare(`SELECT a.*, u.email AS actor_email FROM audit_log a LEFT JOIN platform_user u ON u.id = a.actor_user_id ${where} ORDER BY a.id DESC LIMIT ?`)
    .all(...(action ? [action] : []), Math.min(Number(limit) || 200, 1000));
}
