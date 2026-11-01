import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, key, eligibleIds } from './helpers.js';

let srv, db, d, leadIds;
before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
  d = client(srv.base);
  await d.login('director');
  const ids = await eligibleIds(d, { city: ['Dubai'] }, 4);
  const r = await d.post('/api/cold/transfers', { selection: { mode: 'ids', ids } }, { 'idempotency-key': key() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  leadIds = r.data.items.map((i) => Number(i.crm_link.split('/').pop()));
});
after(async () => { await srv.close(); });

const inquiry = (body) => fetch(srv.base + '/api/public/inquiry', { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-key': 'marinacrest-test-site' }, body: JSON.stringify(body) }).then((r) => r.json());

test('deal value, expected close and tags; list filters by tag and overdue follow-up', async () => {
  const id = leadIds[0];
  assert.equal((await d.patch(`/api/crm/leads/${id}`, { deal_value_aed: -5 })).data.error, 'INVALID_DEAL_VALUE');
  assert.equal((await d.patch(`/api/crm/leads/${id}`, { expected_close: '31/12/2026' })).data.error, 'INVALID_DATE');
  const ok = await d.patch(`/api/crm/leads/${id}`, { deal_value_aed: 2500000, expected_close: '2026-12-31', tags: 'Investor, off plan, investor' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.deal_value_aed, 2500000);
  assert.equal(ok.data.tags, 'investor,off-plan');
  const byTag = (await d.get('/api/crm/leads?tag=off-plan')).data;
  assert.deepEqual(byTag.map((l) => l.id), [id]);
  assert.equal(byTag[0].deal_value_aed, 2500000);

  await d.post(`/api/crm/leads/${leadIds[1]}/tasks`, { title: 'Call back', due_at: new Date(Date.now() - 3600_000).toISOString() });
  const overdue = (await d.get('/api/crm/leads?overdue=1')).data;
  assert.deepEqual(overdue.map((l) => l.id), [leadIds[1]]);
  assert.ok(overdue[0].next_task_due);
});

test('bulk actions: stage, tag and assignee on several leads; agents only touch their own', async () => {
  const team = (await d.get('/api/org/members')).data.members;
  const agent = team.find((m) => m.email === 'agent1@marinacrest.example');
  const r = await d.post('/api/crm/leads/bulk', { ids: [leadIds[2], leadIds[3]], stage: 'QUALIFIED', add_tag: 'VIP', assigned_user_id: agent.user_id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.updated, 2);
  for (const id of [leadIds[2], leadIds[3]]) {
    const l = (await d.get(`/api/crm/leads/${id}`)).data;
    assert.equal(l.stage, 'QUALIFIED');
    assert.ok(l.tags.split(',').includes('vip'));
    assert.equal(l.assigned_user_id, agent.user_id);
  }
  assert.equal((await d.post('/api/crm/leads/bulk', { ids: [leadIds[2]] })).data.error, 'NOTHING_TO_CHANGE');

  const a = client(srv.base);
  await a.login('agent1');
  assert.equal((await a.post('/api/crm/leads/bulk', { ids: [leadIds[2]], assigned_user_id: agent.user_id })).status, 403, 'agents cannot reassign');
  assert.equal((await a.post('/api/crm/leads/bulk', { ids: [leadIds[0]], stage: 'CONTACTED' })).status, 404, 'not their lead');
  assert.equal((await d.get(`/api/crm/leads/${leadIds[0]}`)).data.stage === 'CONTACTED', false, 'nothing changed');
  assert.equal((await a.post('/api/crm/leads/bulk', { ids: [leadIds[2]], stage: 'VIEWING_SCHEDULED' })).data.updated, 1);
});

test('My day: snooze moves a follow-up by a day', async () => {
  const lead = (await d.get(`/api/crm/leads/${leadIds[1]}`)).data;
  const task = lead.tasks.find((t) => !t.done_at);
  const r = await d.post(`/api/crm/tasks/${task.id}/snooze`, { days: 1 });
  assert.equal(r.status, 200);
  assert.ok(new Date(r.data.due_at) > new Date(), 'moved into the future');
  assert.equal((await d.get('/api/crm/leads?overdue=1')).data.length, 0);
});

test('message templates: built-ins for everyone, directors add and remove their own', async () => {
  const list = (await d.get('/api/crm/templates')).data;
  assert.ok(list.some((x) => x.language === 'ar' && x.channel === 'WHATSAPP'));
  const created = await d.post('/api/crm/templates', { name: 'Launch invite', channel: 'WHATSAPP', language: 'en', body: 'Hi {name}, new launch in {area}.' });
  assert.equal(created.status, 200);
  assert.equal((await d.post('/api/crm/templates', { name: 'x', channel: 'SMS', body: 'y' })).data.error, 'INVALID_CHANNEL');
  const a = client(srv.base);
  await a.login('agent1');
  assert.ok((await a.get('/api/crm/templates')).data.some((x) => x.name === 'Launch invite'), 'agents can use them');
  assert.equal((await a.post('/api/crm/templates', { name: 'Mine', channel: 'WHATSAPP', body: 'x' })).status, 403);
  assert.equal((await d.del(`/api/crm/templates/${created.data.id}`)).status, 200);
  assert.ok(!(await d.get('/api/crm/templates')).data.some((x) => x.name === 'Launch invite'));
});

test('duplicate warning: two enquiries from the same mobile point at each other', async () => {
  const base = { full_name: 'Dana Duplicate (TEST)', phone: '050 765 4321', consent_contact: true, area: 'JVC' };
  await inquiry({ ...base, client_event_id: 'dup-1' });
  await inquiry({ ...base, full_name: 'Dana D. (TEST)', client_event_id: 'dup-2' });
  const leads = (await d.get('/api/crm/leads?q=dana')).data;
  assert.equal(leads.length, 2);
  const detail = (await d.get(`/api/crm/leads/${leads[0].id}`)).data;
  assert.deepEqual(detail.duplicates.map((x) => x.id), [leads[1].id]);
});

test('owner sets any user\'s daily limit from the Owner console', async () => {
  const o = client(srv.base);
  await o.login('owner');
  const orgId = (await d.get('/api/me')).data.active_org.org_id;
  const org = (await o.get(`/api/owner/orgs/${orgId}`)).data;
  assert.equal(org.plan.daily_limit, 999);
  const agent = org.members.find((m) => m.email === 'agent1@marinacrest.example');
  assert.equal((await o.patch(`/api/owner/orgs/${orgId}/members/${agent.user_id}`, { daily_cap: 'ten' })).data.error, 'INVALID_CAP');
  assert.equal((await o.patch(`/api/owner/orgs/${orgId}/members/${agent.user_id}`, { daily_cap: 10 })).status, 200);
  const a = client(srv.base);
  await a.login('agent1');
  assert.equal((await a.get('/api/me')).data.my_quota.cap, 10);
  assert.equal((await d.get('/api/org/members')).data.members.find((m) => m.user_id === agent.user_id).daily_cap, 10, 'director sees the same limit');
  assert.equal((await d.get(`/api/owner/orgs/${orgId}`)).status, 403, 'customers cannot use owner endpoints');
});

test('owner deletes one user\'s CRM data, then one account\'s, with typed confirmation', async () => {
  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  const orgId = (await d.get('/api/me')).data.active_org.org_id;
  const org = (await o.get(`/api/owner/orgs/${orgId}`)).data;
  const agent = org.members.find((m) => m.email === 'agent1@marinacrest.example');
  const agentLeads = agent.leads;
  assert.ok(agentLeads >= 2);

  assert.equal((await o.post(`/api/owner/orgs/${orgId}/crm/delete`, { user_id: agent.user_id, confirm: 'yes' })).data.error, 'CONFIRMATION_REQUIRED');
  const one = await o.post(`/api/owner/orgs/${orgId}/crm/delete`, { user_id: agent.user_id, confirm: 'delete crm data' });
  assert.equal(one.status, 200, JSON.stringify(one.data));
  assert.equal(one.data.leads, agentLeads);
  const after = (await o.get(`/api/owner/orgs/${orgId}`)).data;
  assert.equal(after.members.find((m) => m.user_id === agent.user_id).leads, 0);
  assert.ok(after.crm.leads > 0, 'other users keep their leads');
  // The removed records can be acquired again (grant removed with the CRM copy).
  const grants = db.prepare('SELECT COUNT(*) AS n FROM record_acquisition_grant WHERE org_id = ?').get(orgId).n;
  assert.equal(grants, 2, '4 transferred, 2 removed');

  const all = await o.post(`/api/owner/orgs/${orgId}/crm/delete`, { confirm: 'DELETE CRM DATA' });
  assert.equal(all.status, 200);
  assert.equal((await o.get(`/api/owner/orgs/${orgId}`)).data.crm.leads, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_activity WHERE org_id = ?').get(orgId).n, 0);
  assert.equal((await d.get('/api/crm/leads')).data.length, 0);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'OWNER_CRM_DATA_DELETED'").get().n >= 2);
});

test('owner deletes all customers\' CRM data (own owner CRM kept) and all investor data', async () => {
  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  // The owner's own follow-up CRM.
  const found = await o.post('/api/owner/cold/search', { filter: {}, limit: 3 });
  const mine = await o.post('/api/owner/cold/to-crm', { ids: found.data.results.map((r) => r.id) });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  // A customer lead elsewhere.
  await inquiry({ full_name: 'Keep Nobody (TEST)', phone: '050 222 1111', consent_contact: true, client_event_id: 'all-1' });

  assert.equal((await o.post('/api/owner/crm/delete-all', { confirm: 'DELETE CRM DATA' })).data.error, 'CONFIRMATION_REQUIRED');
  const all = await o.post('/api/owner/crm/delete-all', { confirm: 'DELETE ALL CRM DATA' });
  assert.equal(all.status, 200, JSON.stringify(all.data));
  const left = db.prepare(`SELECT o.name, COUNT(*) AS n FROM crm_lead l JOIN organization o ON o.id = l.org_id GROUP BY o.name`).all();
  assert.deepEqual(left.map((r) => r.name), ['AI-DATA owner CRM'], 'only the owner CRM remains');

  const before = db.prepare('SELECT COUNT(*) AS n FROM investor_contact').get().n;
  assert.ok(before > 0);
  assert.equal((await o.post('/api/owner/investors/delete-all', { confirm: 'delete' })).data.error, 'CONFIRMATION_REQUIRED');
  const wipe = await o.post('/api/owner/investors/delete-all', { confirm: 'DELETE ALL INVESTOR DATA' });
  assert.equal(wipe.status, 200, JSON.stringify(wipe.data));
  assert.equal(wipe.data.investors, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM investor_contact').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM investor_transaction').get().n, 0);
  assert.equal((await o.post('/api/owner/cold/search', { filter: {} })).data.counts.total, 0);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM crm_lead l JOIN organization o ON o.id = l.org_id WHERE o.name = 'AI-DATA owner CRM'").get().n > 0, 'CRM copies stay');

  const dir = client(srv.base);
  await dir.login('director');
  assert.equal((await dir.post('/api/owner/investors/delete-all', { confirm: 'DELETE ALL INVESTOR DATA' })).status, 403);
});
