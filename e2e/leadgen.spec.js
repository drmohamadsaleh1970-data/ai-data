import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

// Lead generation through the real screens: an agency creates a campaign page, a visitor
// enquires on the public page, and the lead shows up on the Live leads board by itself.
test.setTimeout(150_000);

function watch(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
  return problems;
}

test('agency: create a campaign page, a visitor enquires, the lead appears live with its campaign', async ({ page, browser }) => {
  const problems = watch(page);
  await signIn(page, 'director');
  await page.goto('/#/overview');
  await page.getByRole('link', { name: 'Lead generation' }).click();
  await expect(page.getByRole('heading', { name: 'Lead generation' })).toBeVisible();

  const form = page.locator('[data-form=lg-create]');
  await form.getByLabel('Campaign name').fill('JVC studios (TEST)');
  await form.getByLabel('Main channel').selectOption('INSTAGRAM');
  await form.getByLabel('Headline on the page').fill('Studios in JVC from AED 650K');
  await form.getByLabel('Description').fill('5-year payment plan.\nHandover 2027.');
  await form.getByLabel('Area').fill('Jumeirah Village Circle');
  await form.getByLabel('Ad spend so far (AED, optional)').fill('500');
  await form.getByRole('button', { name: 'Create campaign page' }).click();
  await expect(page.getByText('Campaign page created ✓')).toBeVisible();

  const card = page.locator('.lg-card').filter({ hasText: 'JVC studios (TEST)' });
  await expect(card).toContainText('Live');
  await expect(card).toContainText('→ Marina Crest Realty (TEST)');
  const qr = card.locator('.lg-qr img');
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((img) => img.complete && img.naturalWidth > 0)).toBeTruthy();
  const url = await card.getByRole('textbox').inputValue();
  expect(url).toMatch(/\/c\/jvc-studios-test-[a-z0-9]+$/);

  // Live board open before the enquiry arrives.
  await page.getByRole('link', { name: 'Live leads' }).first().click();
  await expect(page.getByRole('heading', { name: /Live leads/ })).toBeVisible();

  // A visitor (no sign-in) on the public page, arriving from Instagram.
  const visitor = await browser.newPage();
  const vProblems = watch(visitor);
  await visitor.goto(`${url}?utm_source=instagram`);
  await expect(visitor.getByRole('heading', { name: 'Studios in JVC from AED 650K' })).toBeVisible();
  await expect(visitor.getByText('Marina Crest Realty (TEST)')).toBeVisible();
  await visitor.getByLabel('Full name').fill('Visitor Live (TEST)');
  await visitor.getByLabel('Phone / WhatsApp').fill('0505559911');
  await expect(visitor.getByLabel('Preferred area')).toHaveValue('Jumeirah Village Circle');
  await visitor.getByRole('checkbox').first().check();
  await visitor.getByRole('button', { name: 'Send enquiry' }).click();
  await expect(visitor.getByText('Thank you! An agent will contact you shortly.')).toBeVisible();
  await visitor.close();
  expect(vProblems).toEqual([]);

  // Arrives on the board without reloading (polls every few seconds).
  const row = page.locator('.live-row').filter({ hasText: 'Visitor Live (TEST)' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('NEW');
  await expect(row).toContainText('JVC studios (TEST)');
  await expect(row).toContainText('instagram');
  await expect(row.locator('.live-clock')).toContainText(/left/);

  // Campaign results count it.
  await page.getByRole('link', { name: 'Lead generation' }).first().click();
  const stats = page.locator('.lg-card').filter({ hasText: 'JVC studios (TEST)' }).locator('.lg-stats');
  await expect(stats).toContainText('Leads1');
  await expect(page.locator('.lg-card').filter({ hasText: 'JVC studios (TEST)' })).toContainText('instagram: 1');

  // Pause: the public page says it is closed.
  await page.locator('.lg-card').filter({ hasText: 'JVC studios (TEST)' }).getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Campaign paused')).toBeVisible();
  const v2 = await browser.newPage();
  await v2.goto(url);
  await expect(v2.getByRole('heading', { name: 'This campaign is closed.' })).toBeVisible();
  await v2.close();
  expect(problems).toEqual([]);
});

test('agent sees Live leads but cannot create campaigns; owner sees Meta setup and the pool', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, 'agent1');
  await page.goto('/#/leadgen');
  await expect(page.getByRole('heading', { name: 'Lead generation' })).toBeVisible();
  await expect(page.locator('[data-form=lg-create]')).toHaveCount(0);
  await page.goto('/#/live');
  await expect(page.locator('#live-body')).toContainText('Your Hot leads');

  await page.context().clearCookies();
  await signIn(page, 'owner');
  await page.goto('/#/owner');
  await page.getByRole('link', { name: 'Lead generation' }).click();
  await expect(page.getByRole('heading', { name: 'Meta Lead Ads (Facebook / Instagram)' })).toBeVisible();
  await expect(page.getByText('Not set up on the server yet.')).toBeVisible();
  await expect(page.locator('[data-form=lg-create]').getByLabel('Leads go to')).toBeVisible();
  await page.getByRole('link', { name: 'Live leads' }).first().click();
  await expect(page.getByRole('heading', { name: 'AI-DATA Hot pool' })).toBeVisible();
  await expect(page.locator('#live-body')).toContainText('Hot leads in every account');
  expect(problems).toEqual([]);
});
