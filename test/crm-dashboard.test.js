import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

// CRM dashboard and who may see whose CRM:
//   - the platform owner sees and steers every agency and solo agent (audited);
//   - an agency's managers see their whole agency and each agent in it;
//   - an agent sees only their own leads;
//   - a solo agent's CRM is visible to the solo agent and the owner only.
let srv, db, ids;
const user = (sub) => db.prepare('SELECT id FROM platform_user WHERE google_sub = ?').get(`fixture|${sub}`).id;
const DAY = 86_400_000;
const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

function lead(orgId, { name, stage = 'NEW', assignee = null, deal = null, source = 'HOT', created = -3 * DAY, due = null, contacted = null, phone = '+971501110000', email = 'client@example.invalid' }) {
  const ts = at(created);
  const contactId = Number(db.prepare('INSERT INTO crm_contact (org_id, full_name, email, phone, source_type, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(orgId, name, email, phone, source, ts, ts).lastInsertRowid);
  return Number(db.prepare(`INSERT INTO crm_lead (org_id, contact_id, source_type, source_detail, stage, assigned_user_id, deal_value_aed, first_contact_due, first_contacted_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(orgId, contactId, source, 'TEST', stage, assignee, deal, due, contacted, ts, ts).lastInsertRowid);
}

let L = {};
before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
  ids = srv.ids;
  const agent1 = user('agent1'), agent2 = user('agent2'), solo = user('solo');
  // Agency: A (agent1, contacted on time), C (agent1, won), B (agent2, first contact missed), D (unassigned, new).
  L.A = lead(ids.agency, { name: 'Aaron Alpha (TEST)', stage: 'CONTACTED', assignee: agent1, deal: 1_000_000, due: at(-3 * DAY + 600_000), contacted: at(-3 * DAY + 300_000) });
  L.C = lead(ids.agency, { name: 'Cora Charlie (TEST)', stage: 'CLOSED_WON', assignee: agent1, deal: 2_000_000, source: 'COLD' });
  L.B = lead(ids.agency, { name: 'Bina Bravo (TEST)', stage: 'NEW', assignee: agent2, deal: 500_000, due: at(-2 * DAY) });
  L.D = lead(ids.agency, { name: 'Dev Delta (TEST)', stage: 'NEW' });
  L.S = lead(ids.soloOrg, { name: 'Sara Solo-client (TEST)', stage: 'QUALIFIED', assignee: solo, deal: 3_000_000 });
  const task = db.prepare('INSERT INTO follow_up_task (org_id, lead_id, assignee_id, title, due_at, created_at) VALUES (?,?,?,?,?,?)');
  task.run(ids.agency, L.A, agent1, 'Send floor plans', at(-DAY), at(-2 * DAY));          // overdue
  task.run(ids.agency, L.B, agent2, 'Call back', at(2 * DAY), at(-DAY));                  // upcoming
  task.run(ids.soloOrg, L.S, solo, 'Viewing follow-up', at(-DAY), at(-2 * DAY));          // overdue (solo)
  const act = db.prepare('INSERT INTO lead_activity (org_id, lead_id, user_id, type, body, created_at) VALUES (?,?,?,?,?,?)');
  act.run(ids.agency, L.A, agent1, 'CALL_LOGGED', 'Discussed 2BR in Marina', at(-2 * DAY));
  act.run(ids.soloOrg, L.S, solo, 'MEETING', 'Met at the office', at(-DAY));
});
after(() => srv.close());

test('an agent sees only their own leads; no team table and no way to look at a colleague', async () => {
  const a = client(srv.base);
  await a.login('agent1');
  const d = (await a.get('/api/crm/dashboard')).data;
  assert.equal(d.scope, 'agent');
  assert.equal(d.kpis.total_leads, 2, 'A and C only');
  assert.equal(d.kpis.won, 1);
  assert.equal(d.kpis.open_leads, 1);
  assert.equal(d.kpis.pipeline_value_aed, 1_000_000);
  assert.equal(d.kpis.won_value_aed, 2_000_000);
  assert.equal(d.team, null);
  assert.equal(d.follow_ups.overdue, 1);
  assert.equal(d.activity.by_type.CALL_LOGGED, 1);
  assert.equal(d.sla.met, 1);
  assert.ok(!JSON.stringify(d).includes('Bina Bravo'), 'colleague’s lead never appears');
  const tryOther = (await a.get(`/api/crm/dashboard?agent=${user('agent2')}`)).data;
  assert.equal(tryOther.agent_id, user('agent1'), 'agent parameter is ignored for agents');
  assert.equal((await a.get('/api/owner/crm/overview')).status, 403);
  assert.equal((await a.get(`/api/owner/orgs/${ids.agency}/crm/leads`)).status, 403);
  assert.equal((await a.patch(`/api/crm/leads/${L.B}`, { preferences: { tone: 'FORMAL' } })).status, 404, 'cannot touch a colleague’s lead');
});

test('agency director and team leader monitor the whole agency and each agent, but never the solo agent', async () => {
  for (const persona of ['director', 'leader']) {
    const c = client(srv.base);
    await c.login(persona);
    const d = (await c.get('/api/crm/dashboard')).data;
    assert.equal(d.scope, 'organization', persona);
    assert.equal(d.kpis.total_leads, 4);
    assert.equal(d.kpis.open_leads, 3);
    assert.equal(d.kpis.unassigned_open, 1);
    assert.equal(d.kpis.pipeline_value_aed, 1_500_000);
    assert.equal(d.sla.breached, 1, 'B missed first contact');
    const a1 = d.team.find((m) => m.user_id === user('agent1'));
    assert.equal(a1.leads, 2);
    assert.equal(a1.calls, 1);
    assert.equal(a1.overdue_follow_ups, 1);
    assert.ok(!JSON.stringify(d).includes('Sara Solo-client'), 'solo agent’s CRM is not visible to an agency');
    const one = (await c.get(`/api/crm/dashboard?agent=${user('agent2')}`)).data;
    assert.equal(one.scope, 'agent');
    assert.equal(one.kpis.total_leads, 1);
    assert.equal((await c.get(`/api/crm/dashboard?agent=${user('solo')}`)).status, 404, 'cannot drill into someone outside the agency');
    assert.equal((await c.get('/api/owner/crm/overview')).status, 403);
  }
});

test('a solo agent sees their own CRM; only the platform owner can monitor it', async () => {
  const s = client(srv.base);
  await s.login('solo');
  const d = (await s.get('/api/crm/dashboard')).data;
  assert.equal(d.org.kind, 'AGENT');
  assert.equal(d.kpis.total_leads, 1);
  assert.equal(d.kpis.pipeline_value_aed, 3_000_000);
  assert.equal(d.follow_ups.overdue, 1);
  assert.deepEqual(d.team.map((m) => m.user_id), [user('solo')]);
  assert.ok(!JSON.stringify(d).includes('Aaron Alpha'));
  assert.equal((await s.get(`/api/owner/orgs/${ids.agency}/crm/dashboard`)).status, 403);
});

test('platform owner sees every agency and solo agent, with masked lists and audited drill-down', async () => {
  const o = client(srv.base);
  await o.login('owner');
  const ov = (await o.get('/api/owner/crm/overview')).data;
  const agency = ov.organizations.find((x) => x.id === ids.agency);
  const soloOrg = ov.organizations.find((x) => x.id === ids.soloOrg);
  assert.equal(agency.leads, 4);
  assert.equal(agency.overdue_follow_ups, 1);
  assert.equal(soloOrg.kind, 'AGENT');
  assert.equal(soloOrg.leads, 1);
  assert.ok(ov.totals.solo_agents >= 1 && ov.totals.agencies >= 1);

  const sd = (await o.get(`/api/owner/orgs/${ids.soloOrg}/crm/dashboard`)).data;
  assert.equal(sd.kpis.total_leads, 1);
  const ad = (await o.get(`/api/owner/orgs/${ids.agency}/crm/dashboard?agent=${user('agent1')}`)).data;
  assert.equal(ad.kpis.total_leads, 2);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'OWNER_CRM_DASHBOARD_VIEWED'").get().n >= 2);

  const list = (await o.get(`/api/owner/orgs/${ids.agency}/crm/leads`)).data;
  assert.equal(list.length, 4);
  for (const l of list) {
    assert.ok(!l.phone || l.phone.includes('•'), 'phone masked in the list');
    assert.ok(!l.email || l.email.includes('•'), 'email masked in the list');
  }
  const detail = (await o.get(`/api/owner/orgs/${ids.agency}/crm/leads/${L.B}`)).data;
  assert.equal(detail.phone, '+971501110000', 'opening a lead shows the details');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'OWNER_CRM_LEAD_OPENED' AND target = ?").get(`lead:${L.B}`).n, 1);
  assert.equal((await o.get(`/api/owner/orgs/${ids.soloOrg}/crm/leads/${L.B}`)).status, 404, 'lead must belong to that account');
});

test('platform owner can move a lead and reassign it inside the same account only; every change is logged', async () => {
  const o = client(srv.base);
  await o.login('owner');
  const r = await o.patch(`/api/owner/orgs/${ids.agency}/crm/leads/${L.D}`, { stage: 'ASSIGNED', assigned_user_id: user('agent2') });
  assert.equal(r.status, 200);
  assert.equal(r.data.stage, 'ASSIGNED');
  assert.equal(r.data.assigned_user_id, user('agent2'));
  const acts = db.prepare('SELECT type, body FROM lead_activity WHERE lead_id = ? ORDER BY id').all(L.D);
  assert.ok(acts.some((a) => a.type === 'STAGE_CHANGE' && a.body.startsWith('Platform owner')));
  assert.ok(acts.some((a) => a.type === 'REASSIGNED' && a.body.includes('Leo Agent')));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notification WHERE type = 'LEAD_ASSIGNED' AND user_id = ?").get(user('agent2')).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'OWNER_CRM_LEAD_UPDATED' AND target = ?").get(`lead:${L.D}`).n, 1);

  assert.equal((await o.patch(`/api/owner/orgs/${ids.agency}/crm/leads/${L.D}`, { assigned_user_id: user('solo') })).data.error, 'ASSIGNEE_NOT_IN_ORGANIZATION');
  assert.equal((await o.patch(`/api/owner/orgs/${ids.soloOrg}/crm/leads/${L.S}`, { assigned_user_id: user('director') })).data.error, 'ASSIGNEE_NOT_IN_ORGANIZATION');
  assert.equal((await o.patch(`/api/owner/orgs/${ids.agency}/crm/leads/${L.D}`, { stage: 'MADE_UP' })).data.error, 'INVALID_STAGE');

  const a2 = client(srv.base);
  await a2.login('agent2');
  assert.equal((await a2.get('/api/crm/dashboard')).data.kpis.total_leads, 2, 'reassigned lead now shows in agent2’s dashboard');
  // Put D back so later tests see the original shape.
  db.prepare("UPDATE crm_lead SET stage = 'NEW', assigned_user_id = NULL WHERE id = ?").run(L.D);
});

test('finance admins and signed-out visitors cannot use the owner CRM monitor', async () => {
  const f = client(srv.base);
  await f.login('finance');
  assert.equal((await f.get('/api/owner/crm/overview')).status, 403);
  assert.equal((await f.patch(`/api/owner/orgs/${ids.agency}/crm/leads/${L.A}`, { stage: 'QUALIFIED' })).status, 403);
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/crm/dashboard')).status, 401);
  assert.equal((await anon.get('/api/owner/crm/overview')).status, 401);
});

test('client contact preferences are saved per lead and summarized on the dashboard', async () => {
  const a = client(srv.base);
  await a.login('agent1');
  const r = await a.patch(`/api/crm/leads/${L.A}`, { preferences: { preferred_channel: 'whatsapp', best_time: 'EVENING', tone: 'FRIENDLY', preferred_language: 'ar' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.preferred_channel, 'WHATSAPP');
  assert.equal(r.data.best_time, 'EVENING');
  assert.equal(r.data.tone, 'FRIENDLY');
  assert.equal(r.data.preferred_language, 'ar');
  assert.equal((await a.patch(`/api/crm/leads/${L.A}`, { preferences: { preferred_channel: 'PIGEON' } })).data.error, 'INVALID_CHANNEL');
  assert.equal((await a.patch(`/api/crm/leads/${L.A}`, { preferences: { tone: 'SHOUTY' } })).data.error, 'INVALID_TONE');
  const d = client(srv.base);
  await d.login('director');
  const c = (await d.get('/api/crm/dashboard')).data.communication;
  assert.equal(c.preferred_channel.WHATSAPP, 1);
  assert.equal(c.best_time.EVENING, 1);
  assert.equal(c.tone.FRIENDLY, 1);
  assert.equal(c.language.ar, 1);
  assert.equal(c.with_preferences, 1);
  // Clearing a preference stores "not recorded".
  assert.equal((await a.patch(`/api/crm/leads/${L.A}`, { preferences: { tone: '' } })).data.tone, null);
});

test('template use is counted per template; another account’s template is refused', async () => {
  const d = client(srv.base);
  await d.login('director');
  const tpl = (await d.post('/api/crm/templates', { name: 'Marina intro (TEST)', channel: 'WHATSAPP', language: 'en', body: 'Hi {name}' })).data.id;
  const s = client(srv.base);
  await s.login('solo');
  const soloTpl = (await s.post('/api/crm/templates', { name: 'Solo intro (TEST)', channel: 'EMAIL', language: 'en', body: 'Hello {name}' })).data.id;
  const a = client(srv.base);
  await a.login('agent1');
  assert.equal((await a.post(`/api/crm/leads/${L.A}/activities`, { type: 'WHATSAPP_LOGGED', body: 'Sent intro', template_id: tpl })).status, 200);
  assert.equal((await a.post(`/api/crm/leads/${L.A}/activities`, { type: 'EMAIL_LOGGED', body: 'x', template_id: soloTpl })).data.error, 'UNKNOWN_TEMPLATE');
  const c = (await d.get('/api/crm/dashboard')).data;
  assert.equal(c.communication.templates.find((x) => x.id === tpl).uses_in_period, 1);
  assert.ok(!c.communication.templates.some((x) => x.id === soloTpl), 'solo templates not visible to the agency');
  assert.equal(c.activity.by_type.WHATSAPP_LOGGED, 1);
  assert.equal(c.team.find((m) => m.user_id === user('agent1')).whatsapp, 1);
});

test('period filter: 7, 30 or 90 days; anything else falls back to 30', async () => {
  const d = client(srv.base);
  await d.login('director');
  assert.equal((await d.get('/api/crm/dashboard?days=7')).data.period_days, 7);
  assert.equal((await d.get('/api/crm/dashboard?days=90')).data.period_days, 90);
  assert.equal((await d.get('/api/crm/dashboard?days=5000')).data.period_days, 30);
  assert.equal((await d.get('/api/crm/dashboard?days=7')).data.activity.trend.length, 7);
});
