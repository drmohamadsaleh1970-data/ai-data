import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(() => srv.close());

const inquiry = (siteKey, body, headers = {}) =>
  fetch(srv.base + '/api/public/inquiry', { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-key': siteKey, ...headers }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, data: await r.json() }));

test('public intake answers CORS preflight so other websites can send leads; private API stays same-origin', async () => {
  const r = await fetch(srv.base + '/api/public/inquiry', { method: 'OPTIONS', headers: { origin: 'https://www.ai-home.world', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-site-key' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-allow-headers'), /X-Site-Key/i);
  const priv = await fetch(srv.base + '/api/me', { headers: { origin: 'https://copycat.example' } });
  assert.equal(priv.headers.get('access-control-allow-origin'), null);
});

test('owner website keys: pool key feeds the Hot pool, agency key feeds that CRM, revoked key stops working', async () => {
  const o = client(srv.base);
  await o.login('owner');
  const agency = (await o.get('/api/owner/dashboard')).data.organizations.find((x) => x.name.startsWith('Marina Crest'));
  const pool = (await o.post('/api/owner/hot/site-keys', { label: 'ai-home.world', allowed_origin: 'https://www.ai-home.world/contact' })).data;
  assert.match(pool.key, /^sk_/);
  assert.equal(pool.allowed_origin, 'https://www.ai-home.world');
  const agencyKey = (await o.post('/api/owner/hot/site-keys', { label: 'marinacrest.example', org_id: agency.id })).data;
  const listed = (await o.get('/api/owner/hot')).data.site_keys.map((k) => k.key);
  assert.ok(listed.includes(pool.key) && listed.includes(agencyKey.key));

  // Zapier/Make and plain forms send booleans as text.
  const lead = { full_name: 'Web Lead (TEST)', phone: '0501112233', consent_contact: 'true', consent_marketing: 'yes', area: 'JVC' };
  assert.equal((await inquiry(pool.key, { ...lead, client_event_id: 'w1' }, { origin: 'https://www.ai-home.world' })).data.destination, 'AIHOME_HOT_POOL');
  assert.equal((await inquiry(pool.key, { ...lead, client_event_id: 'w2' }, { origin: 'https://copycat.example' })).data.error, 'ORIGIN_NOT_ALLOWED');
  assert.equal((await inquiry(pool.key, { ...lead, consent_contact: 'no', client_event_id: 'w3' })).data.error, 'CONSENT_REQUIRED');

  const toAgency = await inquiry(agencyKey.key, { ...lead, client_event_id: 'w4' });
  assert.equal(toAgency.data.destination, 'AGENCY_CRM');
  const d = client(srv.base);
  await d.login('director');
  const crmLead = (await d.get(`/api/crm/leads/${toAgency.data.lead_id}`)).data;
  assert.equal(crmLead.source_type, 'HOT');
  assert.equal(crmLead.consent.marketing, true);

  assert.equal((await o.post(`/api/owner/hot/site-keys/${agencyKey.key}/revoke`)).data.revoked, true);
  assert.equal((await inquiry(agencyKey.key, { ...lead, client_event_id: 'w5' })).status, 401);
});

test('only the platform owner manages website keys, with validated input', async () => {
  const d = client(srv.base);
  await d.login('director');
  assert.equal((await d.post('/api/owner/hot/site-keys', { label: 'x' })).status, 403);
  const o = client(srv.base);
  await o.login('owner');
  assert.equal((await o.post('/api/owner/hot/site-keys', { label: '  ' })).data.error, 'LABEL_REQUIRED');
  assert.equal((await o.post('/api/owner/hot/site-keys', { label: 'x', allowed_origin: 'not a url' })).data.error, 'INVALID_ORIGIN');
  assert.equal((await o.post('/api/owner/hot/site-keys', { label: 'x', org_id: 99999 })).data.error, 'ORG_NOT_FOUND');
});
