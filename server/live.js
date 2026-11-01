// Live leads board: Hot leads as they arrive, with the first-contact countdown.
//   - agents: the Hot leads assigned to them;
//   - agency managers / solo agents: their whole organization;
//   - platform owner: the AI-DATA Hot pool plus Hot leads of every account.
// The page polls this every few seconds; `since` lets it mark what is new.
import { getDb } from './db.js';
import { iso, now, dubaiDay } from './util.js';
import { hasPerm } from './auth.js';

const WINDOW_MS = 48 * 3_600_000;
const CLOSED = "('CLOSED_WON','CLOSED_LOST')";

function shape(rows) {
  return rows.map((r) => {
    let area = null, utm = null;
    try { area = JSON.parse(r.interest_json || 'null')?.area || null; } catch { /* none */ }
    try { utm = JSON.parse(r.utm_json || 'null'); } catch { /* none */ }
    return {
      id: Number(r.id), org_id: r.org_id != null ? Number(r.org_id) : null, org_name: r.org_name ?? null, full_name: r.full_name, area,
      campaign: r.campaign_name || null, source: utm?.utm_source || (String(r.source_detail || '').startsWith('CAMPAIGN:') ? 'campaign page' : r.source_detail === 'AIHOME_HOT_ALLOCATION' ? 'AI-DATA Hot pool' : 'website form'),
      stage: r.stage, assignee_name: r.assignee_name || null, created_at: r.created_at, first_contact_due: r.first_contact_due, first_contacted_at: r.first_contacted_at,
    };
  });
}

function stats(leads, nowIso) {
  const today = dubaiDay();
  return {
    new_today: leads.filter((l) => dubaiDay(new Date(l.created_at)) === today).length,
    waiting_first_contact: leads.filter((l) => !l.first_contacted_at).length,
    overdue: leads.filter((l) => !l.first_contacted_at && l.first_contact_due && l.first_contact_due < nowIso).length,
  };
}

const LEAD_SQL = `SELECT l.id, l.org_id, o.name AS org_name, c.full_name, l.interest_json, l.utm_json, l.source_detail, l.stage, l.created_at, l.first_contact_due, l.first_contacted_at,
    u.name AS assignee_name, k.name AS campaign_name
  FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id JOIN organization o ON o.id = l.org_id
  LEFT JOIN platform_user u ON u.id = l.assigned_user_id LEFT JOIN lead_campaign k ON k.id = l.campaign_id`;

export function liveForMember(req) {
  const db = getDb();
  const nowIso = iso();
  const since = iso(new Date(now().getTime() - WINDOW_MS));
  const own = !hasPerm(req, 'crm.all');
  const rows = db.prepare(`${LEAD_SQL} WHERE l.org_id = ? AND l.source_type = 'HOT' ${own ? 'AND l.assigned_user_id = ?' : ''}
      AND (l.created_at >= ? OR (l.first_contacted_at IS NULL AND l.stage NOT IN ${CLOSED})) ORDER BY l.created_at DESC LIMIT 150`)
    .all(...[req.membership.org_id, ...(own ? [req.user.id] : []), since]);
  const leads = shape(rows);
  return { server_time: nowIso, scope: own ? 'mine' : 'organization', leads, pool: null, stats: stats(leads, nowIso) };
}

export function liveForOwner() {
  const db = getDb();
  const nowIso = iso();
  const since = iso(new Date(now().getTime() - WINDOW_MS));
  const leads = shape(db.prepare(`${LEAD_SQL} WHERE l.source_type = 'HOT' AND (l.created_at >= ? OR (l.first_contacted_at IS NULL AND l.stage NOT IN ${CLOSED})) ORDER BY l.created_at DESC LIMIT 300`).all(since));
  const pool = db.prepare(`SELECT p.id, p.full_name, p.interest_json, p.utm_json, p.received_at, p.allocated_org_id, p.allocated_at, p.allocation_method, o.name AS allocated_org_name, k.name AS campaign_name
      FROM hot_lead_pool p LEFT JOIN organization o ON o.id = p.allocated_org_id LEFT JOIN lead_campaign k ON k.id = p.campaign_id
      WHERE p.received_at >= ? OR p.allocated_org_id IS NULL ORDER BY p.received_at DESC LIMIT 200`).all(since).map((p) => {
    let area = null, utm = null;
    try { area = JSON.parse(p.interest_json || 'null')?.area || null; } catch { /* none */ }
    try { utm = JSON.parse(p.utm_json || 'null'); } catch { /* none */ }
    return { id: Number(p.id), full_name: p.full_name, area, campaign: p.campaign_name || null, source: utm?.utm_source || null, received_at: p.received_at,
      allocated_org_name: p.allocated_org_name || null, allocated_at: p.allocated_at, allocation_method: p.allocation_method || null };
  });
  return { server_time: nowIso, scope: 'platform', leads, pool, stats: { ...stats(leads, nowIso), waiting_in_pool: pool.filter((p) => !p.allocated_org_name).length } };
}
