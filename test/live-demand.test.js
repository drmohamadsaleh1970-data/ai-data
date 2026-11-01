import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

// Live demand: lead alerts ("tell me when a studio in Marina ≤ 1M arrives"), anonymous
// search signals on the live board, and Google Ads lead form webhooks.
let srv, db, util, ids, owner;
let ipSeq = 0;
const user = (sub) => db.prepare('SELECT id FROM platform_user WHERE google_sub = ?').get(`fixture|${sub}`).id;
const post = (path, body, headers = {}) => fetch(srv.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.7.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`, ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, data: await r.json() }));
const inquiry = (key, body) => post('/api/public/inquiry', { consent_contact: true, client_event_id: `ld-${ipSeq}-${Math.random()}`, ...body }, { 'x-site-key': key });
const notes = (sub, type) => db.prepare('SELECT body, link FROM notification WHERE user_id = ? AND type = ? ORDER BY id').all(user(sub), type);

before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
  util = await import('../server/util.js');
  ids = srv.ids;
  owner = client(srv.base);
  await owner.login('owner');
  await owner.mfa();
});
after(async () => { util.setClockOffset(0); await srv.close(); });

test('alerts: create, validate, list per person', async () => {
  const d = client(srv.base);
  await d.login('director');
  const list = (await d.post('/api/alerts', { area: 'Marina', bedrooms: '0', budget_max_aed: '1200000' })).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'studio · Marina · up to AED 1,200,000', 'a name is made from the criteria');
  assert.equal(list[0].include_searches, false, 'search signals are for the platform owner only');
  assert.equal((await d.post('/api/alerts', { property_type: 'Castle' })).data.error, 'INVALID_PROPERTY_TYPE');
  assert.equal((await d.post('/api/alerts', { budget_min_aed: 5, budget_max_aed: 1 })).data.error, 'BUDGET_RANGE_INVERTED');
  const a = client(srv.base);
  await a.login('agent1');
  await a.post('/api/alerts', { name: 'Everything for me' });
  assert.equal((await a.get('/api/alerts')).data.length, 1, 'each person sees only their own alerts');
  assert.equal((await a.del(`/api/alerts/${list[0].id}`)).status, 404, 'cannot delete someone else’s alert');
  const f = client(srv.base);
  await f.login('finance');
  assert.equal((await f.get('/api/owner/alerts')).status, 403);
});

test('a matching agency lead notifies within the same request; agents only for their own leads', async () => {
  const before = notes('agent1', 'LEAD_MATCH').length;
  const hit = await inquiry('marinacrest-test-site', { full_name: 'Studio Seeker (TEST)', phone: '0503330001', area: 'Dubai Marina', bedrooms: 0, budget_max_aed: 1000000 });
  assert.equal(hit.data.destination, 'AGENCY_CRM');
  const dn = notes('director', 'LEAD_MATCH');
  assert.equal(dn.length, 1);
  assert.match(dn[0].body, /Studio Seeker \(TEST\)/);
  assert.equal(dn[0].link, `#/crm/lead/${hit.data.lead_id}`);
  await inquiry('marinacrest-test-site', { full_name: 'Villa Seeker (TEST)', phone: '0503330002', area: 'Dubai Marina', bedrooms: 4, budget_max_aed: 9000000 });
  assert.equal(notes('director', 'LEAD_MATCH').length, 1, 'non-matching lead: no alert');
  // agent1's catch-all alert fires only for leads assigned to agent1.
  const assignedToA1 = db.prepare("SELECT COUNT(*) AS n FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id WHERE c.full_name IN ('Studio Seeker (TEST)','Villa Seeker (TEST)') AND l.assigned_user_id = ?").get(user('agent1')).n;
  assert.equal(notes('agent1', 'LEAD_MATCH').length - before, Number(assignedToA1));
  // Live board stars it for the director.
  const d = client(srv.base);
  await d.login('director');
  const live = (await d.get('/api/hot/live')).data;
  assert.deepEqual(live.leads.find((l) => l.full_name === 'Studio Seeker (TEST)').matches, ['studio · Marina · up to AED 1,200,000']);
  assert.deepEqual(live.leads.find((l) => l.full_name === 'Villa Seeker (TEST)').matches, []);
});

test('platform owner: alerts on the Hot pool, on every account, and on anonymous searches (throttled)', async () => {
  const list = (await owner.post('/api/owner/alerts', { name: 'Marina studios', area: 'marina', bedrooms: 0, budget_max_aed: 1200000, include_searches: true })).data;
  assert.equal(list[0].include_searches, true);
  const p = await inquiry('pool-test-site', { full_name: 'Pool Studio (TEST)', phone: '0503330010', area: 'Dubai Marina', bedrooms: '0', budget_max_aed: '950000' });
  assert.equal(p.data.destination, 'AIHOME_HOT_POOL');
  await inquiry('marinacrest-test-site', { full_name: 'Agency Studio (TEST)', phone: '0503330011', area: 'Marina', bedrooms: 0, budget_max_aed: 1100000 });
  const on = notes('owner', 'LEAD_MATCH');
  assert.ok(on.some((n) => /Pool Studio \(TEST\) in the Hot pool/.test(n.body)));
  assert.ok(on.some((n) => /Agency Studio \(TEST\) at Marina Crest Realty \(TEST\)/.test(n.body)));

  const search = (extra = {}) => post('/api/public/search-event', { event_type: 'search_performed', consent_analytics: true, site: 'ai-home.world', city: 'Dubai', area: 'Dubai Marina', property_type: 'Apartment', bedrooms: 0, budget_max_aed: 1000000, purpose: 'buy', ...extra });
  assert.equal((await search({ consent_analytics: false })).data.stored, false, 'no analytics consent: nothing recorded, no alert');
  assert.equal(notes('owner', 'SEARCH_MATCH').length, 0);
  assert.equal((await search()).data.identified, false);
  assert.equal(notes('owner', 'SEARCH_MATCH').length, 1);
  assert.match(notes('owner', 'SEARCH_MATCH')[0].body, /someone is searching studio · Apartment · Dubai Marina · up to AED 1,000,000 on ai-home.world now \(anonymous\)/);
  await search();
  assert.equal(notes('owner', 'SEARCH_MATCH').length, 1, 'at most one search alert per rule every 10 minutes');
  util.setClockOffset(11 * 60_000);
  await search({ bedrooms: '0', budget_max_aed: '900000' });
  util.setClockOffset(0);
  assert.equal(notes('owner', 'SEARCH_MATCH').length, 2);
  await search({ area: 'Palm Jumeirah' });
  assert.equal(notes('owner', 'SEARCH_MATCH').length, 2, 'other searches do not alert');

  const live = (await owner.get('/api/owner/hot/live')).data;
  assert.ok(live.searches.length >= 4);
  assert.ok(live.searches.every((s) => !('full_name' in s) && !('phone' in s)), 'searches carry no identity');
  assert.deepEqual(live.searches.find((s) => s.area === 'Dubai Marina').matches, ['Marina studios']);
  assert.equal(live.top_searches[0].area, 'Dubai Marina');
  assert.ok(live.stats.searches_last_hour >= 4);
  assert.deepEqual(live.pool.find((x) => x.full_name === 'Pool Studio (TEST)').matches, ['Marina studios']);
  // Agencies never see search signals or the owner's alerts.
  const d = client(srv.base);
  await d.login('director');
  assert.equal((await d.get('/api/hot/live')).data.searches, undefined);
});

const gPayload = (key, leadId, extra = {}) => ({
  lead_id: leadId, api_version: '1.0', form_id: 40001, campaign_id: 9001, google_key: key, creative_id: 777, gcl_id: 'GCLID-TEST', is_test: false,
  user_column_data: [
    { column_name: 'Full Name', string_value: 'Gina Google (TEST)', column_id: 'FULL_NAME' },
    { column_name: 'User Phone', string_value: '+971 50 444 5555', column_id: 'PHONE_NUMBER' },
    { column_name: 'User Email', string_value: 'gina@example.invalid', column_id: 'EMAIL' },
    { column_name: 'Preferred area', string_value: 'Business Bay', column_id: 'QUESTION_1' },
    { column_name: 'Budget', string_value: '1,500,000 AED', column_id: 'QUESTION_2' },
  ],
  ...extra,
});

test('Google Ads lead forms: keys per connection, mapping, deduplication, test leads', async () => {
  const pool = (await owner.post('/api/owner/google-ads', { label: 'Google – pool (TEST)' })).data;
  assert.match(pool.hook_key, /^gak_/);
  assert.equal(pool.webhook_path, '/api/webhooks/google-ads');
  const d = client(srv.base);
  await d.login('director');
  const mine = (await d.post('/api/google-ads', { label: 'Marina Google (TEST)' })).data;
  assert.equal(mine.org_id, ids.agency);
  for (const persona of ['agent1', 'leader']) {
    const c = client(srv.base);
    await c.login(persona);
    assert.equal((await c.post('/api/google-ads', { label: 'x' })).status, 403, persona);
    assert.equal((await c.get('/api/google-ads')).status, 403, `${persona} cannot see keys`);
  }
  assert.deepEqual((await d.get('/api/google-ads')).data.hooks.map((h) => h.id), [mine.id], 'agency sees only its own connections');
  assert.equal((await d.del(`/api/google-ads/${pool.id}`)).status, 404);
  assert.equal(db.prepare("SELECT status FROM hot_lead_source WHERE code = 'GOOGLE_ADS'").get().status, 'CONNECTED');

  assert.equal((await post('/api/webhooks/google-ads', gPayload('gak_wrong', 'G1'))).status, 403);
  const r = await post('/api/webhooks/google-ads', gPayload(pool.hook_key, 'G1'));
  assert.deepEqual(r.data, { received: true });
  const p = db.prepare("SELECT * FROM hot_lead_pool WHERE source_code = 'GOOGLE_ADS'").get();
  assert.equal(p.full_name, 'Gina Google (TEST)');
  assert.equal(p.phone, '+971504445555');
  assert.equal(p.email, 'gina@example.invalid');
  const interest = JSON.parse(p.interest_json);
  assert.equal(interest.area, 'Business Bay');
  assert.equal(interest.budget_max_aed, 1_500_000);
  assert.deepEqual(JSON.parse(p.utm_json), { utm_source: 'google', utm_medium: 'lead_form', utm_campaign: '9001', utm_content: '777' });
  assert.equal(JSON.parse(p.consent_json).gclid, 'GCLID-TEST');
  assert.deepEqual((await post('/api/webhooks/google-ads', gPayload(pool.hook_key, 'G1'))).data, { received: true, duplicate: true });

  const t = await post('/api/webhooks/google-ads', gPayload(mine.hook_key, 'G-TEST-1', { is_test: true }));
  assert.equal(t.status, 200);
  const lead = db.prepare("SELECT l.*, c.full_name FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id WHERE c.full_name = 'Gina Google (TEST) (Google test lead)'").get();
  assert.equal(lead.org_id, ids.agency, 'agency connection: straight to its CRM');
  assert.equal(JSON.parse(lead.consent_json).test, true);
  assert.equal(JSON.parse(lead.utm_json).utm_term, 'test');
  assert.equal((await post('/api/webhooks/google-ads', { ...gPayload(pool.hook_key, 'G2'), user_column_data: [{ column_id: 'FULL_NAME', string_value: 'No Contact' }] })).data.error, 'NAME_AND_CONTACT_REQUIRED');
  assert.equal((await owner.del(`/api/owner/google-ads/${pool.id}`)).status, 200);
  assert.equal((await post('/api/webhooks/google-ads', gPayload(pool.hook_key, 'G3'))).status, 403, 'removed connection stops accepting');
});

test('a lead from the search-capture box keeps the visitor’s search and source', async () => {
  const r = await inquiry('pool-test-site', { full_name: 'Capture Visitor (TEST)', phone: '0503330099', area: 'Dubai Marina', property_type: 'Apartment', bedrooms: 0, budget_max_aed: 1000000,
    message: 'Asked for matching homes while searching: studio · Apartment · Dubai Marina · up to AED 1,000,000 · buy', utm_source: 'ai-home.world search', utm_medium: 'search_match' });
  const p = db.prepare('SELECT * FROM hot_lead_pool WHERE id = ?').get(r.data.pool_id);
  assert.deepEqual(JSON.parse(p.utm_json), { utm_source: 'ai-home.world search', utm_medium: 'search_match' });
  assert.equal(JSON.parse(p.interest_json).bedrooms, 0);
  const live = (await owner.get('/api/owner/hot/live')).data;
  const row = live.pool.find((x) => x.full_name === 'Capture Visitor (TEST)');
  assert.equal(row.source, 'ai-home.world search');
  assert.deepEqual(row.matches, ['Marina studios']);
});
