import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startTestServer, client, key, eligibleIds } from './helpers.js';

let srv, util, db;
before(async () => {
  srv = await startTestServer();
  util = await import('../server/util.js');
  db = (await import('../server/db.js')).getDb();
});
after(async () => { util.setClockOffset(0); await srv.close(); });

const inquiry = (body, siteKey = 'marinacrest-test-site') =>
  fetch(srv.base + '/api/public/inquiry', { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-key': siteKey }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json() }));

test('real web-form inquiry becomes a HOT lead with consent evidence, assigned and notified; no Cold quota used', async () => {
  const d = client(srv.base);
  await d.login('director');
  const before = (await d.get('/api/me/entitlements')).data.cold.quota.committed_used;
  const body = { full_name: 'Hana Hotlead (TEST)', phone: '050 123 4567', email: 'hana@example.invalid', consent_contact: true, consent_marketing: true, area: 'Dubai Marina', property_type: 'Apartment', bedrooms: 2, budget_max_aed: 2000000, client_event_id: 'evt-1' };
  assert.equal((await inquiry({ ...body, consent_contact: false })).data.error, 'CONSENT_REQUIRED');
  assert.equal((await inquiry(body, 'wrong-key')).status, 401);
  const r = await inquiry(body);
  assert.equal(r.data.destination, 'AGENCY_CRM');
  assert.equal((await inquiry(body)).data.duplicate, true, 'retry does not duplicate');
  const lead = await d.get(`/api/crm/leads/${r.data.lead_id}`);
  assert.equal(lead.data.source_type, 'HOT');
  assert.equal(lead.data.phone, '+971501234567');
  assert.equal(lead.data.consent.contact, true);
  assert.ok(lead.data.assigned_user_id);
  assert.ok(new Date(lead.data.first_contact_due) - new Date(lead.data.created_at) <= 15 * 60_000);
  assert.equal((await d.get('/api/me/entitlements')).data.cold.quota.committed_used, before);
  const notified = db.prepare("SELECT COUNT(*) AS n FROM notification WHERE type = 'HOT_LEAD' AND user_id = ?").get(lead.data.assigned_user_id).n;
  assert.equal(notified, 1);
});

test('unconfigured connectors show NOT_CONNECTED / APPROVAL_REQUIRED, never live', async () => {
  const d = client(srv.base);
  await d.login('director');
  const { data } = await d.get('/api/integrations');
  const by = Object.fromEntries(data.sources.map((s) => [s.code, s.status]));
  for (const k of ['META_LEAD_ADS', 'GOOGLE_ADS', 'TIKTOK', 'WHATSAPP', 'PROPERTY_FINDER', 'BAYUT']) assert.equal(by[k], 'NOT_CONNECTED');
  assert.equal(by.LINKEDIN, 'APPROVAL_REQUIRED');
  assert.equal(data.paypal, 'NOT_CONNECTED');
});

test('anonymous search is analytics only — never an identified lead', async () => {
  const leadsBefore = db.prepare('SELECT COUNT(*) AS n FROM crm_lead').get().n;
  const r = await fetch(srv.base + '/api/public/search-event', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_type: 'search_performed', consent_analytics: true, city: 'Dubai', area: 'Dubai Marina', property_type: 'Apartment', bedrooms: 2, budget_max_aed: 2000000, email: 'leak@x.com' }) }).then((x) => x.json());
  assert.deepEqual(r, { stored: true, identified: false });
  const row = db.prepare('SELECT * FROM anonymous_search_event ORDER BY id DESC LIMIT 1').get();
  assert.ok(!JSON.stringify(row).includes('leak@x.com'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM crm_lead').get().n, leadsBefore);
  const noConsent = await fetch(srv.base + '/api/public/search-event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_type: 'search_performed' }) }).then((x) => x.json());
  assert.equal(noConsent.stored, false);
});

test('Hot monetization is gated until the owner configures pricing; allocation bills a separate ledger once', async () => {
  const pool = await inquiry({ full_name: 'Pool Person (TEST)', email: 'pool@example.invalid', consent_contact: true, client_event_id: 'p1' }, 'pool-test-site');
  assert.equal(pool.data.destination, 'AIHOME_HOT_POOL');
  const o = client(srv.base);
  await o.login('owner');
  assert.equal((await o.get('/api/public/plans')).data.hot.status, 'OWNER_CONFIGURATION_REQUIRED');
  assert.equal((await o.post(`/api/owner/hot/pool/${pool.data.pool_id}/allocate`, { org_id: srv.ids.agency })).data.error, 'OWNER_CONFIGURATION_REQUIRED');
  await o.mfa();
  await o.post('/api/owner/hot/pricing', { model: 'PER_LEAD', price_usd: 25 });
  assert.equal((await o.post(`/api/owner/hot/pool/${pool.data.pool_id}/allocate`, { org_id: srv.ids.agency })).data.error, 'NO_HOT_CREDITS', 'Cold plan does not include Hot');
  await o.post('/api/owner/hot/entitlements', { org_id: srv.ids.agency, credits: 10 });
  const a = await o.post(`/api/owner/hot/pool/${pool.data.pool_id}/allocate`, { org_id: srv.ids.agency });
  assert.ok(a.data.crm_lead_id);
  assert.equal((await o.post(`/api/owner/hot/pool/${pool.data.pool_id}/allocate`, { org_id: srv.ids.soloOrg })).data.error, 'ALREADY_ALLOCATED');
  const d = client(srv.base);
  await d.login('director');
  const hot = (await d.get('/api/hot')).data;
  assert.equal(hot.ledger.length, 1);
  assert.equal(hot.ledger[0].amount_cents, 2500);
  assert.equal(hot.entitlements[0].credits_used, 1);
});

test('missed first-contact SLA notifies agent, then escalates to team leader/manager', async () => {
  const { runSlaSweep } = await import('../server/crm.js');
  const r = await inquiry({ full_name: 'Sla Person (TEST)', phone: '+971500000001', consent_contact: true, client_event_id: 'sla-1' });
  util.setClockOffset(20 * 60_000);
  runSlaSweep();
  const lead = db.prepare('SELECT * FROM crm_lead WHERE id = ?').get(r.data.lead_id);
  assert.equal(lead.escalation_level, 1);
  runSlaSweep();
  const leader = db.prepare("SELECT id FROM platform_user WHERE google_sub='fixture|leader'").get().id;
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND type='SLA_ESCALATION'").get(leader).n >= 1);
  util.setClockOffset(0);
});

test('subject opt-out propagates to tenant CRM copies and blocks logged outreach', async () => {
  const d = client(srv.base);
  await d.login('director');
  const [id] = await eligibleIds(d, {}, 1);
  const t = await d.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [id] } }, { 'idempotency-key': key() });
  const leadId = t.data.items[0].crm_lead_id;
  const o = client(srv.base);
  await o.login('owner');
  assert.equal((await o.post(`/api/owner/investors/${id}/suppress`, { reason: 'Data subject opt-out' })).data.propagated_to, 1);
  const lead = (await d.get(`/api/crm/leads/${leadId}`)).data;
  assert.equal(lead.suppressed, 1);
  assert.equal(lead.outreach_allowed, false);
  assert.equal((await d.post(`/api/crm/leads/${leadId}/activities`, { type: 'CALL_LOGGED', body: 'x' })).data.error, 'CONTACT_SUPPRESSED');
  const s = await d.post('/api/cold/search', { filter: {}, limit: 50 });
  // Suppressed records can no longer be transferred by anyone else.
  const solo = client(srv.base);
  await solo.login('solo');
  const r = await solo.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [id] } }, { 'idempotency-key': key() });
  assert.equal(r.data.items[0].reason, 'SUPPRESSED_DO_NOT_CONTACT');
  assert.ok(s.status === 200);
});

test('historical transfer never overwrites a fresher CRM contact (link only)', async () => {
  const d = client(srv.base);
  await d.login('director');
  const inv = db.prepare("SELECT * FROM investor_contact WHERE rights_status='APPROVED' AND suppressed=0 AND email IS NOT NULL AND id NOT IN (SELECT investor_id FROM record_acquisition_grant) LIMIT 1").get();
  // Agency already has this person from a recent verified Hot inquiry with a new number.
  const r = await inquiry({ full_name: inv.full_name, email: inv.email, phone: '+971559999999', consent_contact: true, client_event_id: 'fresh-1' });
  const t = await d.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [inv.id] } }, { 'idempotency-key': key() });
  assert.equal(t.data.charged, 1);
  const contacts = db.prepare('SELECT * FROM crm_contact WHERE org_id = ? AND lower(email) = lower(?)').all(srv.ids.agency, inv.email);
  assert.equal(contacts.length, 1, 'no duplicate contact');
  assert.equal(contacts[0].phone, '+971559999999', 'fresh phone kept');
  assert.equal(contacts[0].investor_id, inv.id, 'history linked');
  assert.ok(r.data.lead_id);
});

test('leads form.xlsx import maps all 38 original columns, preserves raw row, validates', async () => {
  const { LEADS_FORM_COLUMNS } = await import('../server/crm.js');
  assert.equal(LEADS_FORM_COLUMNS.length, 38);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');
  ws.addRow(LEADS_FORM_COLUMNS);
  const row = (o) => LEADS_FORM_COLUMNS.map((c) => o[c] ?? '');
  ws.addRow(row({ contactId: 'C1', fullName: 'Imported One (TEST)', mobile: '0501112233', email: 'one@example.invalid', CITY: 'Dubai', unitType: '2BR', budgetFrom: '1000000', budgetTo: '2000000', nationality: 'Fictional' }));
  ws.addRow(row({ contactId: 'C2', fullName: '', mobile: '' }));
  const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  const d = client(srv.base);
  await d.login('director');
  const preview = await d.post('/api/crm/import', { file_base64: b64 });
  assert.deepEqual(preview.data.missing_columns, []);
  assert.equal(preview.data.valid, 1);
  assert.equal((await d.post('/api/crm/import', { file_base64: b64, commit: true })).data.error, 'RIGHTS_CONFIRMATION_REQUIRED');
  const done = await d.post('/api/crm/import', { file_base64: b64, commit: true, rights_confirmed: true });
  assert.equal(done.data.created, 1);
  const c = db.prepare("SELECT * FROM crm_contact WHERE full_name = 'Imported One (TEST)'").get();
  assert.equal(c.phone, '+971501112233');
  assert.equal(c.source_type, 'MANUAL');
  assert.equal(Object.keys(JSON.parse(c.raw_import_json)).length, 38);
});

test('stage changes are audited and first contact is recorded only on an explicit contacted stage', async () => {
  const d = client(srv.base);
  await d.login('director');
  const lead = (await d.get('/api/crm/leads?source=HOT')).data[0];
  const a = await d.post(`/api/crm/leads/${lead.id}/activities`, { type: 'CONTACT_ATTEMPT', body: 'Rang, no answer' });
  assert.equal(a.data.first_contacted_at, null);
  const u = await d.patch(`/api/crm/leads/${lead.id}`, { stage: 'CONTACTED' });
  assert.ok(u.data.first_contacted_at);
  assert.ok(u.data.activities.some((x) => x.type === 'STAGE_CHANGE'));
  const rep = await d.get('/api/reports');
  assert.ok(rep.data.by_source.find((s) => s.source_type === 'COLD'));
  assert.ok(rep.data.by_source.find((s) => s.source_type === 'HOT'));
});
