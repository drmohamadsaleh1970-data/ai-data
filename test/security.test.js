import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startTestServer, client, key, eligibleIds } from './helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

test('subscribers cannot reach any raw export route', async () => {
  const c = client(srv.base);
  await c.login('director');
  for (const url of ['/api/investor-history/export', '/api/investor-history/export/all', '/api/cold/export?format=xlsx', '/api/cold/csv', '/api/crm/export', '/api/crm/dump']) {
    const r = await c.get(url);
    assert.equal(r.status, 403, url);
    assert.equal(r.data.error, 'EXPORT_NOT_PERMITTED');
  }
  // Owner endpoints reject subscriber sessions regardless of anything in the request.
  for (const [m, url] of [['post', '/api/owner/cold-exports'], ['get', '/api/owner/cold-exports/1'], ['post', '/api/owner/cold/search'], ['get', '/api/owner/audit']]) {
    const r = await c[m](url, m === 'post' ? { role: 'PLATFORM_OWNER', platform_role: 'PLATFORM_OWNER' } : { 'x-role': 'PLATFORM_OWNER' });
    assert.equal(r.status, 403, url);
  }
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/owner/cold-exports/1')).status, 401);
});

test('finance admin cannot export; owner export needs fresh MFA and yields a watermarked XLSX', async () => {
  const f = client(srv.base);
  await f.login('finance');
  await f.mfa();
  assert.equal((await f.post('/api/owner/cold-exports', { filter: {} })).status, 403);

  const o = client(srv.base);
  await o.login('owner');
  const noMfa = await o.post('/api/owner/cold-exports', { filter: { city: ['Dubai'] } });
  assert.equal(noMfa.status, 401);
  assert.equal(noMfa.data.error, 'MFA_REQUIRED');
  assert.equal((await o.post('/api/me/mfa/verify', { code: '000000' })).status, 401);
  await o.mfa();
  const job = await o.post('/api/owner/cold-exports', { filter: { city: ['Dubai'] }, fields: ['investor_id', 'full_name', 'email', 'phone', 'area', 'price_aed'] });
  assert.equal(job.status, 200);
  assert.ok(job.data.rows > 0);
  const file = await o.get(`/api/owner/cold-exports/${job.data.job_id}`);
  assert.equal(file.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(file.data));
  const ws = wb.getWorksheet('Transactions');
  assert.match(ws.getRow(1).getCell(1).text, /CONFIDENTIAL — AI-DATA owner export/);
  assert.deepEqual(ws.getRow(2).values.slice(1), ['investor_id', 'full_name', 'email', 'phone', 'area', 'price_aed']);
  assert.equal(ws.rowCount - 2, job.data.rows);
  assert.ok(wb.getWorksheet('Manifest'));
  const audit = await o.get('/api/owner/audit?action=OWNER_XLSX_EXPORT');
  assert.equal(audit.data.length, 1);
  const denied = await o.get('/api/owner/audit?action=RAW_EXPORT_DENIED');
  assert.ok(denied.data.length >= 6);
});

test('CSRF header is required for state-changing calls', async () => {
  const c = client(srv.base);
  await c.login('director');
  const r = await c.post('/api/cold/search', { filter: {} }, { 'x-aihome-csrf': '' });
  assert.equal(r.status, 403);
});

test('tenant and record isolation is enforced by the server', async () => {
  const solo = client(srv.base);
  await solo.login('solo');
  const ids = await eligibleIds(solo, {}, 2);
  const t = await solo.post('/api/cold/transfers', { selection: { mode: 'ids', ids } }, { 'idempotency-key': key() });
  const soloLead = t.data.items[0].crm_lead_id;

  const d = client(srv.base);
  await d.login('director');
  assert.equal((await d.get(`/api/crm/leads/${soloLead}`)).status, 404, 'other tenant lead invisible');
  assert.equal((await d.get(`/api/cold/transfers/${t.data.job_id}`)).status, 404);
  assert.equal((await d.get(`/api/organizations/${srv.ids.soloOrg}/usage`)).status, 403);
  assert.equal((await d.post('/api/me/active-org', { org_id: srv.ids.soloOrg })).status, 403);
  // Director's search shows the solo agent's acquisitions as NOT acquired (per-org grants).
  const s = await d.post('/api/cold/search', { filter: {}, limit: 50 });
  assert.ok(s.data.results.filter((r) => ids.includes(r.id)).every((r) => !r.acquired));

  // Agent sees only own assigned leads.
  const agentIds = await eligibleIds(d, {}, 2);
  const dt = await d.post('/api/cold/transfers', { selection: { mode: 'ids', ids: agentIds }, assign_to: (await d.get('/api/org/members')).data.members.find((m) => m.name.startsWith('Leo')).user_id }, { 'idempotency-key': key() });
  const leoLead = dt.data.items[0].crm_lead_id;
  const aisha = client(srv.base);
  await aisha.login('agent1');
  assert.equal((await aisha.get(`/api/crm/leads/${leoLead}`)).status, 404);
  const leo = client(srv.base);
  await leo.login('agent2');
  assert.equal((await leo.get(`/api/crm/leads/${leoLead}`)).status, 200);
  // Agents cannot invite members or assign transfers to others.
  assert.equal((await leo.post('/api/org/invitations', { email: 'x@y.example', role: 'AGENT' })).status, 403);
});

test('platform owner is never granted by email, name or request parameters', async () => {
  const u = client(srv.base);
  await u.login('newuser');
  const r = await u.post('/api/owner/bootstrap', { token: 'guess' });
  assert.equal(r.status, 409, 'owner already exists → bootstrap closed');
  const me = await u.get('/api/me');
  assert.equal(me.data.user.platform_role, null);
});
