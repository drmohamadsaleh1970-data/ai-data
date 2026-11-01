import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

// The reported bug: owner signs in, adds Master Cold records to "AI-DATA owner CRM",
// opens the CRM - and must stay signed in with the CRM showing the records.
test('owner adds records to their own CRM, opens it and stays signed in', async () => {
  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  const found = await o.post('/api/owner/cold/search', { filter: {}, limit: 10 });
  assert.equal(found.status, 200, JSON.stringify(found.data));
  const ids = found.data.results.map((r) => r.id).slice(0, 5);
  assert.ok(ids.length > 0);

  const added = await o.post('/api/owner/cold/to-crm', { ids });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.ok(added.data.added + added.data.already + added.data.skipped === ids.length);

  const me = (await o.get('/api/me')).data;
  const crmOrg = me.memberships.find((m) => m.name === 'AI-DATA owner CRM');
  assert.ok(crmOrg, 'owner CRM organization exists');
  assert.equal((await o.post('/api/me/active-org', { org_id: crmOrg.org_id })).status, 200);

  const leads = await o.get('/api/crm/leads');
  assert.equal(leads.status, 200, JSON.stringify(leads.data));
  assert.ok(leads.data.length >= added.data.added);
  const after = (await o.get('/api/me')).data;
  assert.equal(after.authenticated, true);
  assert.equal(after.active_org?.org_id, crmOrg.org_id);

  // Adding the same records again does not duplicate them.
  const again = await o.post('/api/owner/cold/to-crm', { ids });
  assert.equal(again.data.added, 0);
});

// Every screen's data loads without a server error, for every kind of user.
test('every page endpoint answers without a server error for each role', async () => {
  const pages = ['/api/me', '/api/me/notifications', '/api/me/entitlements', '/api/org/members', '/api/billing', '/api/cold/filters',
    '/api/cold/acquired', '/api/cold/presets', '/api/crm/leads', '/api/crm/tasks', '/api/crm/pipeline', '/api/reports', '/api/hot',
    '/api/integrations', '/api/owner/dashboard', '/api/owner/cold/filters', '/api/owner/export-fields', '/api/owner/hot',
    '/api/owner/source', '/api/owner/provenance', '/api/owner/flags', '/api/owner/audit', '/api/public/plans', '/api/health'];
  for (const persona of ['owner', 'finance', 'director', 'leader', 'agent1', 'solo', 'pending']) {
    const c = client(srv.base);
    await c.login(persona);
    await c.mfa();
    const me = (await c.get('/api/me')).data;
    for (const url of [...pages, ...(me.active_org ? [`/api/organizations/${me.active_org.org_id}/usage`] : [])]) {
      const r = await c.get(url);
      assert.ok(r.status < 500, `${persona} ${url} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
  }
});
