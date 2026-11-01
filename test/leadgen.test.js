import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startTestServer, client } from './helpers.js';

// Hot lead generation: campaign pages (+ attribution and tracking), the live leads board,
// and the Meta Lead Ads connector (Graph API replaced by a local stub).
let srv, db, ids, owner, graph, graphBase;
let ipSeq = 0;
const user = (sub) => db.prepare('SELECT id FROM platform_user WHERE google_sub = ?').get(`fixture|${sub}`).id;
const inquiry = (siteKey, body) => fetch(srv.base + '/api/public/inquiry', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-site-key': siteKey, 'x-forwarded-for': `10.9.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}` },
  body: JSON.stringify({ consent_contact: true, client_event_id: `ev-${ipSeq}-${Math.random()}`, ...body }),
}).then(async (r) => ({ status: r.status, data: await r.json() }));

const GRAPH_LEADS = {
  'lead-pool-1': { field_data: [{ name: 'full_name', values: ['Meta Pool Person (TEST)'] }, { name: 'phone_number', values: ['+971501112233'] }, { name: 'email', values: ['meta.pool@example.invalid'] }, { name: 'preferred_area', values: ['Palm Jumeirah'] }, { name: 'your_budget', values: ['AED 3,500,000'] }, { name: 'when_do_you_plan_to_buy?', values: ['Within 3 months'] }], form_id: 'F1', ad_id: 'A1', ad_name: 'Palm villas ad', campaign_name: 'Palm Q4', platform: 'ig', created_time: '2026-11-01T08:00:00+0000' },
  'lead-agency-1': { field_data: [{ name: 'first_name', values: ['Mona'] }, { name: 'last_name', values: ['Agency-Meta (TEST)'] }, { name: 'phone_number', values: ['0502223344'] }], form_id: 'F2', platform: 'fb' },
};

before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
  ids = srv.ids;
  owner = client(srv.base);
  await owner.login('owner');
  await owner.mfa();
  graph = http.createServer((req, res) => {
    const id = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').pop());
    const token = new URL(req.url, 'http://x').searchParams.get('access_token');
    if (token !== 'PAGE-TOKEN-0123456789-abcdef' || !GRAPH_LEADS[id]) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Invalid lead or token' } })); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id, ...GRAPH_LEADS[id] }));
  }).listen(0);
  await new Promise((r) => graph.once('listening', r));
  graphBase = `http://127.0.0.1:${graph.address().port}`;
});
after(async () => { for (const k of ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_GRAPH_URL']) delete process.env[k]; graph.close(); await srv.close(); });

let agencyCampaign, poolCampaign;

test('agency managers create campaign pages; agents and team leaders cannot; each account sees only its own', async () => {
  const d = client(srv.base);
  await d.login('director');
  const r = await d.post('/api/campaigns', { name: 'Marina 2BR launch (TEST)', channel: 'INSTAGRAM', headline: 'New 2BR in Dubai Marina', area: 'Dubai Marina', property_type: 'Apartment', language: 'en', privacy_url: 'https://marinacrest.example/privacy', spend_aed: 1000 });
  assert.equal(r.status, 200);
  agencyCampaign = r.data;
  assert.match(agencyCampaign.slug, /^marina-2br-launch-test-[a-z0-9]+$/);
  assert.equal(agencyCampaign.org_id, ids.agency);
  assert.ok(agencyCampaign.site_key.startsWith('sk_'));
  assert.equal((await d.post('/api/campaigns', { name: 'x', headline: 'y', privacy_url: 'javascript:alert(1)' })).data.error, 'INVALID_PRIVACY_URL');
  assert.equal((await d.post('/api/campaigns', { name: '', headline: 'y' })).data.error, 'NAME_REQUIRED');
  for (const persona of ['agent1', 'leader']) {
    const c = client(srv.base);
    await c.login(persona);
    assert.equal((await c.post('/api/campaigns', { name: 'Nope', headline: 'Nope' })).status, 403, persona);
    assert.equal((await c.patch(`/api/campaigns/${agencyCampaign.id}`, { status: 'PAUSED' })).status, 403, persona);
  }
  const a = client(srv.base);
  await a.login('agent1');
  assert.equal((await a.get('/api/campaigns')).data.campaigns.length, 1, 'agents can see the results');
  const s = client(srv.base);
  await s.login('solo');
  assert.equal((await s.get('/api/campaigns')).data.campaigns.length, 0, 'solo agent does not see the agency’s campaigns');
  assert.equal((await s.patch(`/api/campaigns/${agencyCampaign.id}`, { status: 'PAUSED' })).status, 404);
});

test('public campaign page data and QR code', async () => {
  const p = await fetch(`${srv.base}/api/public/campaigns/${agencyCampaign.slug}`).then((r) => r.json());
  assert.equal(p.brand, 'Marina Crest Realty (TEST)');
  assert.equal(p.headline, 'New 2BR in Dubai Marina');
  assert.equal(p.active, true);
  assert.equal(p.site_key, agencyCampaign.site_key);
  assert.equal((await fetch(`${srv.base}/api/public/campaigns/no-such-page`)).status, 404);
  const qr = await fetch(`${srv.base}/api/public/campaigns/${agencyCampaign.slug}/qr.svg`);
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await qr.text(), /^<svg[\s\S]+<path d="M/);
  const page = await fetch(`${srv.base}/c/${agencyCampaign.slug}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /campaign\.js/);
});

test('enquiries from a campaign page are attributed to the campaign and to the ad source', async () => {
  const r = await inquiry(agencyCampaign.site_key, { full_name: 'Insta Lead (TEST)', phone: '0501230001', campaign: agencyCampaign.slug, utm_source: 'instagram', utm_medium: 'bio' });
  assert.equal(r.data.destination, 'AGENCY_CRM');
  const lead = db.prepare('SELECT * FROM crm_lead WHERE id = ?').get(r.data.lead_id);
  assert.equal(lead.campaign_id, agencyCampaign.id);
  assert.equal(lead.campaign_tag, 'Marina 2BR launch (TEST)');
  assert.deepEqual(JSON.parse(lead.utm_json), { utm_source: 'instagram', utm_medium: 'bio' });
  assert.equal(JSON.parse(lead.consent_json).channel, 'CAMPAIGN_PAGE');
  // The campaign's key alone (e.g. from Zapier) is attributed too.
  const r2 = await inquiry(agencyCampaign.site_key, { full_name: 'Key Only (TEST)', phone: '0501230002' });
  assert.equal(db.prepare('SELECT campaign_id FROM crm_lead WHERE id = ?').get(r2.data.lead_id).campaign_id, agencyCampaign.id);
  // A campaign cannot be claimed with another site's key.
  assert.equal((await inquiry('marinacrest-test-site', { full_name: 'Wrong (TEST)', phone: '0501230003', campaign: agencyCampaign.slug })).data.error, 'UNKNOWN_CAMPAIGN');
});

test('campaign tracking: leads, contact, wins, spend and cost per lead, by source', async () => {
  const d = client(srv.base);
  await d.login('director');
  const leadId = db.prepare("SELECT l.id FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id WHERE c.full_name = 'Insta Lead (TEST)'").get().id;
  await d.patch(`/api/crm/leads/${leadId}`, { stage: 'CONTACTED' });
  await d.patch(`/api/crm/leads/${leadId}`, { stage: 'CLOSED_WON', deal_value_aed: 2_000_000 });
  const c = (await d.get('/api/campaigns')).data.campaigns[0];
  assert.equal(c.received, 2);
  assert.equal(c.contacted, 1);
  assert.equal(c.won, 1);
  assert.equal(c.won_value_aed, 2_000_000);
  assert.equal(c.cost_per_lead_aed, 500);
  assert.equal(c.cost_per_won_aed, 1000);
  assert.deepEqual(c.by_source, { instagram: 1, direct: 1 });
  assert.equal((await d.patch(`/api/campaigns/${agencyCampaign.id}`, { spend_aed: 3000 })).data.spend_aed, 3000);
});

test('a paused campaign page stops taking enquiries', async () => {
  const d = client(srv.base);
  await d.login('director');
  assert.equal((await d.patch(`/api/campaigns/${agencyCampaign.id}`, { status: 'PAUSED' })).data.status, 'PAUSED');
  const p = await fetch(`${srv.base}/api/public/campaigns/${agencyCampaign.slug}`).then((r) => r.json());
  assert.equal(p.active, false);
  assert.equal(p.site_key, null);
  assert.equal((await inquiry(agencyCampaign.site_key, { full_name: 'Late (TEST)', phone: '0501230004', campaign: agencyCampaign.slug })).data.error, 'CAMPAIGN_PAUSED');
  await d.patch(`/api/campaigns/${agencyCampaign.id}`, { status: 'ACTIVE' });
});

test('owner campaigns feed the Hot pool; the campaign stays on the lead after allocation', async () => {
  const r = await owner.post('/api/owner/campaigns', { name: 'Palm villas (TEST)', channel: 'FACEBOOK', headline: 'Palm Jumeirah villas', language: 'ar' });
  assert.equal(r.status, 200);
  poolCampaign = r.data;
  assert.equal(poolCampaign.org_id, null);
  const p = await fetch(`${srv.base}/api/public/campaigns/${poolCampaign.slug}`).then((x) => x.json());
  assert.equal(p.brand, 'AI-DATA');
  const q = await inquiry(poolCampaign.site_key, { full_name: 'Pool Campaign Lead (TEST)', phone: '0501230010', campaign: poolCampaign.slug, utm_source: 'facebook' });
  assert.equal(q.data.destination, 'AIHOME_HOT_POOL');
  const row = db.prepare('SELECT * FROM hot_lead_pool WHERE id = ?').get(q.data.pool_id);
  assert.equal(row.campaign_id, poolCampaign.id);
  await owner.post('/api/owner/hot/pricing', { model: 'PER_LEAD', price_aed: 100 });
  await owner.post('/api/owner/hot/entitlements', { org_id: ids.soloOrg, credits: 1 });
  const alloc = await owner.post(`/api/owner/hot/pool/${q.data.pool_id}/allocate`, { org_id: ids.soloOrg });
  const lead = db.prepare('SELECT campaign_id, utm_json FROM crm_lead WHERE id = ?').get(alloc.data.crm_lead_id);
  assert.equal(lead.campaign_id, poolCampaign.id);
  assert.equal(JSON.parse(lead.utm_json).utm_source, 'facebook');
  const all = (await owner.get('/api/owner/campaigns')).data;
  const pc = all.campaigns.find((c) => c.id === poolCampaign.id);
  assert.equal(pc.received, 1);
  assert.equal(pc.in_crm, 1);
  assert.equal(pc.waiting_in_pool, 0);
  assert.ok(all.campaigns.some((c) => c.id === agencyCampaign.id), 'owner sees every campaign');
  // Owner can also make a campaign that goes straight to one account.
  const forSolo = await owner.post('/api/owner/campaigns', { name: 'Solo page (TEST)', headline: 'Solo', org_id: ids.soloOrg });
  assert.equal(forSolo.data.org_id, ids.soloOrg);
  const s = client(srv.base);
  await s.login('solo');
  assert.equal((await s.get('/api/campaigns')).data.campaigns.length, 1);
  const f = client(srv.base);
  await f.login('director');
  assert.equal((await f.post('/api/owner/campaigns', { name: 'x', headline: 'y' })).status, 403);
});

test('live leads board: agents see their own, managers the agency, the owner everything plus the pool', async () => {
  const a = client(srv.base);
  await a.login('agent1');
  const mine = (await a.get('/api/hot/live')).data;
  assert.equal(mine.scope, 'mine');
  const a1 = user('agent1');
  const dbMine = db.prepare("SELECT COUNT(*) AS n FROM crm_lead WHERE org_id = ? AND source_type = 'HOT' AND assigned_user_id = ?").get(ids.agency, a1).n;
  assert.equal(mine.leads.length, dbMine);
  const d = client(srv.base);
  await d.login('director');
  const org = (await d.get('/api/hot/live')).data;
  assert.equal(org.scope, 'organization');
  assert.ok(org.leads.length >= 2);
  assert.ok(org.leads.every((l) => l.org_id === ids.agency));
  const insta = org.leads.find((l) => l.full_name === 'Insta Lead (TEST)');
  assert.equal(insta.campaign, 'Marina 2BR launch (TEST)');
  assert.equal(insta.source, 'instagram');
  assert.equal(typeof org.stats.waiting_first_contact, 'number');
  assert.ok(!JSON.stringify(org).includes('Pool Campaign Lead'), 'agency never sees the pool or other accounts');
  const o = (await owner.get('/api/owner/hot/live')).data;
  assert.equal(o.scope, 'platform');
  assert.ok(o.pool.some((p) => p.full_name === 'Pool Campaign Lead (TEST)' && p.allocated_org_name === 'Sam Solo Properties (TEST)'));
  assert.ok(o.leads.some((l) => l.org_id === ids.soloOrg) && o.leads.some((l) => l.org_id === ids.agency));
  const f = client(srv.base);
  await f.login('finance');
  assert.equal((await f.get('/api/owner/hot/live')).status, 403);
  assert.equal((await client(srv.base).get('/api/hot/live')).status, 401);
});

test('Meta Lead Ads: off until the server is configured', async () => {
  assert.equal((await fetch(`${srv.base}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`)).status, 404);
  const st = (await owner.get('/api/owner/meta')).data;
  assert.equal(st.configured, false);
  assert.equal((await owner.post('/api/owner/meta/pages', { page_id: '1234567890', access_token: 'PAGE-TOKEN-0123456789-abcdef' })).data.error, 'META_NOT_CONFIGURED');
});

const sign = (raw) => `sha256=${crypto.createHmac('sha256', 'test-app-secret').update(raw).digest('hex')}`;
const hook = (payload, signature) => {
  const raw = JSON.stringify(payload);
  return fetch(`${srv.base}/api/webhooks/meta`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? sign(raw) }, body: raw })
    .then(async (r) => ({ status: r.status, data: await r.json() }));
};
const leadgen = (pageId, leadgenId) => ({ object: 'page', entry: [{ id: pageId, time: 1, changes: [{ field: 'leadgen', value: { page_id: pageId, leadgen_id: leadgenId, form_id: 'F', created_time: 1 } }] }] });

test('Meta Lead Ads: verification, connecting Pages (encrypted token), signed webhooks into the pool or an agency', async () => {
  Object.assign(process.env, { META_APP_SECRET: 'test-app-secret', META_VERIFY_TOKEN: 'verify-me-please', META_GRAPH_URL: graphBase });
  const ok = await fetch(`${srv.base}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=CH4LL3NGE`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'CH4LL3NGE');
  assert.equal((await fetch(`${srv.base}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status, 403);

  assert.equal((await owner.post('/api/owner/meta/pages', { page_id: 'abc', access_token: 'PAGE-TOKEN-0123456789-abcdef' })).data.error, 'INVALID_PAGE_ID');
  assert.equal((await owner.post('/api/owner/meta/pages', { page_id: '111222333', page_name: 'AI Home (TEST)', access_token: 'PAGE-TOKEN-0123456789-abcdef', campaign_id: poolCampaign.id })).status, 200);
  assert.equal((await owner.post('/api/owner/meta/pages', { page_id: '444555666', page_name: 'Marina page (TEST)', access_token: 'PAGE-TOKEN-0123456789-abcdef', org_id: ids.agency, campaign_id: poolCampaign.id })).data.error, 'CAMPAIGN_DESTINATION_MISMATCH');
  assert.equal((await owner.post('/api/owner/meta/pages', { page_id: '444555666', page_name: 'Marina page (TEST)', access_token: 'PAGE-TOKEN-0123456789-abcdef', org_id: ids.agency, campaign_id: agencyCampaign.id })).status, 200);
  const stored = db.prepare("SELECT token_enc FROM meta_page WHERE page_id = '111222333'").get().token_enc;
  assert.ok(!stored.includes('PAGE-TOKEN'), 'token is not stored in plain text');
  assert.equal(db.prepare("SELECT status FROM hot_lead_source WHERE code = 'META_LEAD_ADS'").get().status, 'CONNECTED');

  assert.equal((await hook(leadgen('111222333', 'lead-pool-1'), 'sha256=deadbeef')).status, 401, 'bad signature refused');
  const r = await hook(leadgen('111222333', 'lead-pool-1'));
  assert.deepEqual(r.data, { processed: 1, duplicates: 0, ignored: 0 });
  const p = db.prepare("SELECT * FROM hot_lead_pool WHERE source_code = 'META_LEAD_ADS' AND provider_event_id = 'lead-pool-1'").get();
  assert.equal(p.full_name, 'Meta Pool Person (TEST)');
  assert.equal(p.phone, '+971501112233');
  assert.equal(p.campaign_id, poolCampaign.id);
  const interest = JSON.parse(p.interest_json);
  assert.equal(interest.area, 'Palm Jumeirah');
  assert.equal(interest.budget_max_aed, 3_500_000);
  assert.match(interest.message, /when do you plan to buy\?: Within 3 months/);
  assert.deepEqual(JSON.parse(p.utm_json), { utm_source: 'instagram', utm_medium: 'lead_ads', utm_campaign: 'Palm Q4', utm_content: 'Palm villas ad' });
  const consent = JSON.parse(p.consent_json);
  assert.equal(consent.channel, 'META_LEAD_ADS');
  assert.equal(consent.marketing, false, 'marketing consent never assumed');

  assert.deepEqual((await hook(leadgen('111222333', 'lead-pool-1'))).data, { processed: 0, duplicates: 1, ignored: 0 }, 'Meta retries never duplicate');
  const a = await hook(leadgen('444555666', 'lead-agency-1'));
  assert.equal(a.data.processed, 1);
  const lead = db.prepare("SELECT l.*, c.full_name, c.phone FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id WHERE c.full_name = 'Mona Agency-Meta (TEST)'").get();
  assert.equal(lead.org_id, ids.agency);
  assert.equal(lead.campaign_id, agencyCampaign.id);
  assert.equal(lead.phone, '+971502223344');
  assert.equal((await hook(leadgen('999999999', 'lead-pool-1'))).data.ignored, 1, 'unknown Page ignored');
  const fail = await hook(leadgen('111222333', 'no-such-lead'));
  assert.equal(fail.status, 502, 'Meta will retry when the lead cannot be read');
  assert.match(db.prepare("SELECT last_error FROM meta_page WHERE page_id = '111222333'").get().last_error, /Invalid lead or token/);

  const f = client(srv.base);
  await f.login('director');
  assert.equal((await f.get('/api/owner/meta')).status, 403);
  const fresh = client(srv.base);
  await fresh.login('owner');
  assert.equal((await fresh.post('/api/owner/meta/pages', { page_id: '777888999', access_token: 'PAGE-TOKEN-0123456789-abcdef' })).data.error, 'MFA_REQUIRED');
  const pid = db.prepare("SELECT id FROM meta_page WHERE page_id = '444555666'").get().id;
  assert.equal((await owner.del(`/api/owner/meta/pages/${pid}`)).status, 200);
});

test('Meta field mapping handles first/last names and custom questions', async () => {
  const { mapFields } = await import('../server/meta.js');
  const m = mapFields([{ name: 'first_name', values: ['Ali'] }, { name: 'last_name', values: ['Hassan'] }, { name: 'email', values: ['a@b.co'] }, { name: 'number_of_bedrooms', values: ['3'] }, { name: 'property_type_interest', values: ['Villa'] }]);
  assert.equal(m.full_name, 'Ali Hassan');
  assert.equal(m.bedrooms, 3);
  assert.equal(m.property_type, 'Villa');
  assert.equal(m.email, 'a@b.co');
});
