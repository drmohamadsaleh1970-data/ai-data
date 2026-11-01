// Once the agency gives a lead (Cold or Hot) to an agent, it is not available to the
// other agents: they see who has it, cannot open it, and a repeat of the same person goes
// back to the same agent instead of a second colleague calling them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, key, eligibleIds } from './helpers.js';

let srv, db;
before(async () => {
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
});
after(async () => { await srv.close(); });

const inquiry = (body) =>
  fetch(srv.base + '/api/public/inquiry', { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-key': 'marinacrest-test-site' }, body: JSON.stringify(body) }).then((r) => r.json());

test('Cold record given to one agent shows as taken to the other agent and cannot be transferred again', async () => {
  const d = client(srv.base); await d.login('director');
  const a1 = client(srv.base); await a1.login('agent1');
  const a2 = client(srv.base); await a2.login('agent2');
  const me1 = (await a1.get('/api/me')).data.user.id;
  const me2 = (await a2.get('/api/me')).data.user.id;
  const [id] = await eligibleIds(d, {}, 1);
  const r = await d.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [id] }, idempotency_key: key(), assign_to: me1 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accepted, 1);

  const find = async (c) => {
    let cursor = null;
    for (;;) {
      const { data } = await c.post('/api/cold/search', { filter: {}, cursor, limit: 50 });
      const hit = data.results.find((x) => x.id === id);
      if (hit || !data.next_cursor) return hit;
      cursor = data.next_cursor;
    }
  };
  const seenBy1 = await find(a1);
  assert.equal(seenBy1.acquired, true);
  assert.equal(seenBy1.assigned_to_me, true);
  const seenBy2 = await find(a2);
  assert.equal(seenBy2.acquired, true);
  assert.equal(seenBy2.assigned_to_me, false);
  assert.equal(seenBy2.assigned_to, 'Aisha Agent (TEST)');

  // Agent 2 trying to take it anyway: no second lead, no charge.
  const again = await a2.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [id] }, idempotency_key: key(), assign_to: me2 });
  assert.equal(again.data.accepted, 0);
  assert.equal(again.data.already_acquired, 1);
  const leads = db.prepare('SELECT COUNT(*) AS n FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id WHERE c.investor_id = ?').get(id).n;
  assert.equal(leads, 1);

  const lead = r.data.items.find((i) => i.investor_id === id).crm_lead_id;
  assert.equal((await a2.get(`/api/crm/leads/${lead}`)).status, 404, 'other agent cannot open it');
  const mine = (await a2.get('/api/cold/acquired')).data.find((x) => x.investor_id === id);
  assert.equal(mine.assigned_user_id, me1);
});

test('A second Hot inquiry from the same person updates their existing lead — no duplicate, same agent', async () => {
  const body = { full_name: 'Rami Repeat (TEST)', phone: '050 765 4321', consent_contact: true };
  const first = await inquiry({ ...body, client_event_id: 'repeat-1' });
  const holder = db.prepare('SELECT assigned_user_id FROM crm_lead WHERE id = ?').get(first.lead_id).assigned_user_id;
  for (let i = 0; i < 3; i++) await inquiry({ full_name: `Other ${i} (TEST)`, phone: `050 111 22${i}${i}`, consent_contact: true, client_event_id: `other-${i}` });
  // Same person, different number format and an email this time.
  const second = await inquiry({ ...body, phone: '+971507654321', email: 'rami@example.invalid', area: 'JVC', client_event_id: 'repeat-2' });
  assert.equal(second.lead_id, first.lead_id, 'no second lead');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM crm_contact WHERE phone = '+971507654321'").get().n, 1, 'no second contact');
  assert.equal(db.prepare('SELECT assigned_user_id FROM crm_lead WHERE id = ?').get(first.lead_id).assigned_user_id, holder);
  const act = db.prepare("SELECT body FROM lead_activity WHERE lead_id = ? AND type = 'REPEAT_INQUIRY'").get(first.lead_id);
  assert.match(act.body, /JVC/);
});

test('Cold record for a person already in the CRM from a Hot inquiry is linked, not re-sent or charged', async () => {
  const d = client(srv.base); await d.login('director');
  const [id] = await eligibleIds(d, { has_email: true }, 1);
  const inv = db.prepare('SELECT full_name, email FROM investor_contact WHERE id = ?').get(id);
  const hotLead = (await inquiry({ full_name: inv.full_name, email: inv.email, consent_contact: true, client_event_id: `pre-${id}` })).lead_id;
  const before = (await d.get('/api/me/entitlements')).data.cold.quota.committed_used;
  const r = await d.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [id] }, idempotency_key: key() });
  assert.equal(r.data.charged, 0);
  assert.equal(r.data.already_acquired, 1);
  assert.equal(r.data.items[0].reason, 'NO_CHARGE_PERSON_ALREADY_IN_CRM');
  assert.equal(r.data.items[0].crm_lead_id, hotLead);
  assert.equal((await d.get('/api/me/entitlements')).data.cold.quota.committed_used, before);
  const leads = db.prepare('SELECT COUNT(*) AS n FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id WHERE c.org_id = (SELECT org_id FROM crm_lead WHERE id = ?) AND lower(c.email) = lower(?)').get(hotLead, inv.email).n;
  assert.equal(leads, 1);
});
