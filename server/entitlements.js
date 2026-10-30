import { getDb } from './db.js';
import { config } from './config.js';
import { now, dubaiDay, nextDubaiMidnight, iso } from './util.js';

// The single source of truth for whether an organization may make paid Cold transfers.
// Cold entitlement never implies Hot entitlement and vice versa.
export function activeSubscription(orgId, at = now()) {
  const db = getDb();
  const rows = db.prepare(`SELECT s.*, p.cold_daily_limit, p.name AS plan_name, p.raw_export_allowed
    FROM subscription s JOIN subscription_plan p ON p.code = s.plan_code
    WHERE s.org_id = ? AND s.status IN ('ACTIVE','PAST_DUE','CANCELLED') ORDER BY s.effective_at DESC, s.id DESC`).all(orgId);
  const graceMs = config.graceDays * 86_400_000;
  for (const s of rows) {
    if (!s.current_period_end || (s.effective_at && s.effective_at > iso(at))) continue;
    const end = new Date(s.current_period_end).getTime() + graceMs;
    if (s.status === 'PAST_DUE' && config.graceDays === 0) continue;
    if (at.getTime() < end) return s;
  }
  return null;
}

export function latestSubscription(orgId) {
  return getDb().prepare(`SELECT s.*, p.name AS plan_name FROM subscription s JOIN subscription_plan p ON p.code = s.plan_code
    WHERE s.org_id = ? ORDER BY s.id DESC LIMIT 1`).get(orgId) || null;
}

// Reads (or lazily creates) today's shared quota row. Called inside the transfer
// transaction so the read and the increment are covered by the same write lock.
export function quotaAccount(orgId, sub, conn = getDb(), at = now()) {
  const day = dubaiDay(at);
  let row = conn.prepare('SELECT * FROM daily_quota_account WHERE org_id = ? AND local_day = ?').get(orgId, day);
  const limit = sub?.cold_daily_limit ?? 0;
  if (!row) {
    conn.prepare('INSERT INTO daily_quota_account (org_id, local_day, plan_code, plan_limit, committed_used) VALUES (?,?,?,?,0)')
      .run(orgId, day, sub?.plan_code ?? 'NONE', limit);
    row = { org_id: orgId, local_day: day, plan_code: sub?.plan_code ?? 'NONE', plan_limit: limit, committed_used: 0 };
  } else if (sub && (row.plan_code !== sub.plan_code || row.plan_limit !== limit)) {
    // Plan change mid-day: the new limit applies from now; already-committed usage stands.
    conn.prepare('UPDATE daily_quota_account SET plan_code = ?, plan_limit = ? WHERE org_id = ? AND local_day = ?')
      .run(sub.plan_code, limit, orgId, day);
    row = { ...row, plan_code: sub.plan_code, plan_limit: limit };
  }
  return { ...row, remaining: Math.max(0, row.plan_limit - row.committed_used), resets_at: nextDubaiMidnight(at), timezone: 'Asia/Dubai' };
}

export function entitlementSummary(orgId) {
  const sub = activeSubscription(orgId);
  const quota = sub ? quotaAccount(orgId, sub) : null;
  const hot = getDb().prepare("SELECT COALESCE(SUM(credits_total - credits_used),0) AS credits FROM hot_lead_entitlement WHERE org_id = ? AND status='ACTIVE'").get(orgId);
  return {
    cold: sub
      ? { active: true, plan: sub.plan_code, plan_name: sub.plan_name, period_end: sub.current_period_end, provider: sub.provider, quota }
      : { active: false, latest: latestSubscription(orgId) },
    hot: { credits_remaining: hot.credits, included_in_cold_plan: false },
    raw_export_allowed: false,
  };
}
