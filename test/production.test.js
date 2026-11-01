import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

// The real portal: no demo or test sign-in, no fictional data, and the platform owner
// comes from settings (OWNER_EMAIL, OWNER_TOTP_SECRET).
let srv, db;
before(async () => {
  process.env.OWNER_EMAIL = 'Owner@Example.com';
  process.env.OWNER_TOTP_SECRET = 'JBSW Y3DP EHPK 3PXP';
  srv = await startTestServer({ fixtures: false, testLogin: false });
  db = (await import('../server/db.js')).getDb();
});
after(() => srv.close());

test('no demo or test sign-in routes exist in the real portal', async () => {
  const c = client(srv.base);
  for (const [method, url] of [['post', '/api/auth/demo'], ['get', '/api/demo/totp'], ['get', '/api/demo/outbox'], ['post', '/api/test/login'], ['get', '/api/test/totp']]) {
    assert.equal((await c[method](url)).status, 404, url);
  }
  const cfg = (await c.get('/api/auth/config')).data;
  assert.equal('demo_mode' in cfg, false);
  assert.equal((await c.get('/api/me')).data.authenticated, false);
});

test('starts empty: reference data only, no fictional people, agencies or investors', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM subscription_plan WHERE public_purchasable = 1').get().n, 2);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM hot_lead_source').get().n > 0);
  for (const table of ['organization', 'investor_contact', 'crm_lead', 'site_key', 'cash_payment_request']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.deepEqual(db.prepare('SELECT email, platform_role FROM platform_user').all().map((r) => ({ ...r })), [{ email: 'owner@example.com', platform_role: 'PLATFORM_OWNER' }]);
});

test('the owner from settings is linked on Google sign-in; other accounts never become owner', async () => {
  const { upsertGoogleUser } = await import('../server/auth.js');
  const { ensureOwner } = await import('../server/seed.js');
  const ownerId = db.prepare("SELECT id FROM platform_user WHERE platform_role = 'PLATFORM_OWNER'").get().id;
  assert.equal(upsertGoogleUser({ sub: 'google-owner-1', email: 'OWNER@example.com', name: 'Owner' }), ownerId);
  const row = db.prepare('SELECT * FROM platform_user WHERE id = ?').get(ownerId);
  assert.equal(row.google_sub, 'google-owner-1');
  assert.equal(row.mfa_secret, 'JBSWY3DPEHPK3PXP');

  const other = upsertGoogleUser({ sub: 'google-other', email: 'someone@example.com', name: 'Platform Owner' });
  assert.notEqual(other, ownerId);
  assert.equal(db.prepare('SELECT platform_role FROM platform_user WHERE id = ?').get(other).platform_role, null);

  // Start-up runs again (new instance on the same database): no duplicate, role kept.
  assert.equal(ensureOwner(), ownerId);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_user WHERE platform_role = 'PLATFORM_OWNER'").get().n, 1);
});

test('several owners: every listed email is an owner, the first one is the main owner', async () => {
  const { upsertGoogleUser } = await import('../server/auth.js');
  const { ensureOwner } = await import('../server/seed.js');
  const before = process.env.OWNER_EMAIL;
  process.env.OWNER_EMAIL = 'owner@example.com, Second.Owner@Example.com';
  try {
    const mainId = ensureOwner();
    assert.equal(db.prepare('SELECT email FROM platform_user WHERE id = ?').get(mainId).email, 'owner@example.com');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_user WHERE platform_role = 'PLATFORM_OWNER'").get().n, 2);
    const second = upsertGoogleUser({ sub: 'google-owner-2', email: 'second.owner@example.com', name: 'Second' });
    assert.notEqual(second, mainId);
    assert.equal(db.prepare('SELECT platform_role, google_sub FROM platform_user WHERE id = ?').get(second).platform_role, 'PLATFORM_OWNER');
    assert.equal(ensureOwner(), mainId, 'main owner stays first');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_user WHERE platform_role = 'PLATFORM_OWNER'").get().n, 2);
  } finally {
    process.env.OWNER_EMAIL = before;
  }
});
