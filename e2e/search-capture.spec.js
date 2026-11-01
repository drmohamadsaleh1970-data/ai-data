import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

// A visitor searches "studio, Dubai Marina, up to AED 1M" on a property website that has
// the search capture; the owner sees the anonymous search and, once the visitor asks for
// matches, the Hot lead, starred by the owner's alert, on Live leads.
test.setTimeout(150_000);

test('search capture → anonymous search signal + Hot lead within seconds, starred by an alert', async ({ page, browser, baseURL }) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
  await signIn(page, 'owner');
  const h = { 'x-aihome-csrf': '1' };
  const campaign = await (await page.request.post('/api/owner/campaigns', { data: { name: 'ai-home search (TEST)', channel: 'WEBSITE', headline: 'Matching homes' }, headers: h })).json();

  // Owner sets an alert on the Live leads page.
  await page.goto('/#/owner');
  await page.getByRole('link', { name: 'Live leads' }).click();
  await expect(page.getByRole('heading', { name: '⭐ My lead alerts' })).toBeVisible();
  const form = page.locator('[data-form=alert-create]');
  await form.getByLabel('Alert name').fill('Marina studios ≤ 1.2M');
  await form.getByLabel('Area').fill('Marina');
  await form.getByLabel('Bedrooms').selectOption('0');
  await form.getByLabel('Budget up to (AED)').fill('1200000');
  await form.getByLabel(/Also alert me when someone is searching/).check();
  await form.getByRole('button', { name: 'Create alert' }).click();
  await expect(page.getByText('Alert created ✓')).toBeVisible();
  await expect(page.locator('.card').filter({ hasText: '⭐ My lead alerts' })).toContainText('studio · Marina · up to AED 1,200,000');

  // The Lead generation page gives the code for the website.
  await page.getByRole('link', { name: 'Lead generation' }).first().click();
  const capture = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Search capture for your website' }) });
  await capture.getByLabel('Campaign for these leads').selectOption({ label: 'ai-home search (TEST)' });
  await expect(capture.locator('.code')).toContainText(`data-campaign="${campaign.slug}"`);
  await expect(capture.locator('.code')).toContainText('search-capture.js');

  // Back to Live leads, then the visitor searches on "ai-home.world".
  await page.getByRole('link', { name: 'Live leads' }).first().click();
  await expect(page.getByRole('heading', { name: '🔎 Searching now on ai-home.world' })).toBeVisible();
  const visitor = await browser.newPage();
  const vErrors = [];
  visitor.on('pageerror', (e) => vErrors.push(e.message));
  await visitor.setContent(`<!doctype html><html><body><h1>ai-home.world (test copy)</h1>
    <button id="go">Search</button>
    <script>window.aidataSearch = window.aidataSearch || function () { (aidataSearch.q = aidataSearch.q || []).push(arguments); };
      document.getElementById('go').onclick = () => aidataSearch({ area: 'Dubai Marina', property_type: 'Apartment', bedrooms: 0, budget_max_aed: 1000000, purpose: 'buy' }, { analytics: true });</script>
    <script src="${baseURL}/search-capture.js" data-site-key="${campaign.site_key}" data-campaign="${campaign.slug}" data-lang="en" data-privacy-url="https://example.invalid/privacy"></script></body></html>`);
  await visitor.getByRole('button', { name: 'Search' }).click();
  const box = visitor.getByRole('dialog', { name: 'Get matching homes on WhatsApp' });
  await expect(box).toContainText('studios in Dubai Marina up to AED 1,000,000');

  // The anonymous search reaches the owner's board by itself, starred.
  const searchRow = page.locator('.card').filter({ has: page.getByRole('heading', { name: '🔎 Searching now on ai-home.world' }) }).locator('.live-row').first();
  await expect(searchRow).toContainText('Studio · Apartment · Dubai Marina', { timeout: 20_000 });
  await expect(searchRow).toContainText('⭐ Marina studios ≤ 1.2M');

  // The visitor asks for matches.
  await box.getByPlaceholder('Your name').fill('Search Visitor (TEST)');
  await box.getByPlaceholder('WhatsApp / phone').fill('0505551777');
  await box.getByRole('button', { name: 'Send me matches' }).click();
  await expect(box.getByPlaceholder('Your name')).toHaveValue('Search Visitor (TEST)'); // consent not ticked: nothing sent
  await box.getByRole('checkbox').check();
  await box.getByRole('button', { name: 'Send me matches' }).click();
  await expect(box).toContainText('Thank you! An advisor will send you matching homes shortly.');
  await visitor.close();
  expect(vErrors).toEqual([]);

  // Within seconds: in the Hot pool, starred, with the search as source.
  const poolRow = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'AI-DATA Hot pool' }) }).locator('.live-row').filter({ hasText: 'Search Visitor (TEST)' });
  await expect(poolRow).toBeVisible({ timeout: 20_000 });
  await expect(poolRow).toContainText('NEW');
  await expect(poolRow).toContainText('⭐ Marina studios ≤ 1.2M');
  await expect(poolRow).toContainText('ai-home search (TEST)');
  await expect(poolRow).toContainText('ai-home.world search');
  expect(problems).toEqual([]);
});
