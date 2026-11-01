import { test, expect } from '@playwright/test';

// Named zz- so it runs last: it approves Hot pricing in the shared test database, which
// changes what the public landing page shows (public.spec.js expects it unpriced).
import { signIn } from './helpers.js';

// Owner turns on automatic distribution on the Hot page; a new pool lead lands in the
// next customer's CRM by itself and shows as "Auto" in the pool list.
test.setTimeout(120_000);

test('owner: automatic distribution of Hot pool leads, through the real page', async ({ page }) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
  await signIn(page, 'owner');
  // Fresh authenticator check, then pricing and credits (as the forms on the page do).
  const { code } = await (await page.request.get('/api/test/totp')).json();
  const h = { 'x-aihome-csrf': '1' };
  expect((await page.request.post('/api/me/mfa/verify', { data: { code }, headers: h })).ok()).toBeTruthy();
  expect((await page.request.post('/api/owner/hot/pricing', { data: { model: 'PER_LEAD', price_aed: 150 }, headers: h })).ok()).toBeTruthy();
  const orgs = (await (await page.request.get('/api/owner/dashboard')).json()).organizations;
  const marina = orgs.find((o) => o.name === 'Marina Crest Realty (TEST)');
  expect((await page.request.post('/api/owner/hot/entitlements', { data: { org_id: marina.id, credits: 3 }, headers: h })).ok()).toBeTruthy();

  await page.goto('/#/owner/hot');
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Automatic distribution' }) });
  await expect(card).toContainText('OFF');
  await expect(card.getByRole('row').filter({ hasText: 'Marina Crest Realty (TEST)' })).toContainText('next');
  await card.getByRole('button', { name: 'Turn on' }).click();
  await expect(card).toContainText('ON');

  const r = await page.request.post('/api/public/inquiry', {
    headers: { 'x-site-key': 'pool-test-site' },
    data: { full_name: 'Auto Shared (TEST)', phone: '0507771234', consent_contact: true, area: 'JVC', client_event_id: `auto-${Date.now()}` },
  });
  expect((await r.json()).destination).toBe('AIHOME_HOT_POOL');
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: 'Auto Shared (TEST)' });
  await expect(row).toContainText('Marina Crest Realty (TEST)');
  await expect(row).toContainText('Auto');

  // Leave the switch off for the other tests.
  await page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Automatic distribution' }) }).getByRole('button', { name: 'Turn off' }).click();
  await expect(page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Automatic distribution' }) })).toContainText('OFF');
  expect(problems).toEqual([]);
});
