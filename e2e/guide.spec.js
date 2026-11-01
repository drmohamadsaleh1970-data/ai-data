import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

// Guide page: opens on the signed-in person's role, steps are clickable, progress is
// kept, the flow diagram explains each step, and each role sees the right guides.
test.setTimeout(120_000);

function watch(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
  return problems;
}

test('agency director: guide opens on their role, steps, progress and flow work', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, 'director');
  await page.goto('/#/overview');
  await page.getByRole('link', { name: 'Guide' }).click();
  await expect(page.getByRole('heading', { name: 'How to use AI-DATA' })).toBeVisible();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(page.getByRole('tab', { name: /Agency manager/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Agency manager/ })).toContainText('You');

  // Open a step; its "Go there" link points at the real page.
  await page.locator('.gstation', { hasText: 'Find investors' }).click();
  await expect(page.locator('.gdetail')).toContainText('Step 4 of 10');
  await expect(page.locator('.gdetail').getByRole('link', { name: 'Go there →' })).toHaveAttribute('href', '#/investor-history');

  // Mark done → progress, kept after a reload.
  await page.locator('.gdetail').getByLabel('Done').check();
  await expect(page.locator('.gprog')).toContainText('1 / 10');
  await page.reload();
  await expect(page.locator('.gprog')).toContainText('1 / 10');
  await expect(page.locator('.gstation').nth(3)).toHaveClass(/done/);

  // Next / Back.
  await page.locator('.gstation').first().click();
  await expect(page.getByRole('button', { name: '← Back' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.locator('.gdetail')).toContainText('Pay and activate');

  // Flow diagram and another role's guide.
  await page.getByRole('button', { name: 'Activation code' }).click();
  await expect(page.locator('.gflow-note')).toContainText('8-character code');
  await page.getByRole('tab', { name: /Agent in an agency/ }).click();
  await expect(page.locator('.ghero')).toContainText('Agent in an agency');
  await expect(page.locator('.gdetail').getByRole('link', { name: 'Go there →' })).toHaveCount(0);
  await expect(page.locator('.gaccess tr.gsel')).toContainText('Agent in an agency');
  await page.locator('.gfaq summary').first().click();
  await expect(page.locator('.gfaq[open] p')).toBeVisible();
  expect(problems).toEqual([]);
});

test('agent and solo agent each land on their own guide; owner sees every role; finance sees finance only', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, 'agent1');
  await page.goto('/#/guide');
  await expect(page.getByRole('tab', { name: /Agent in an agency/ })).toHaveAttribute('aria-selected', 'true');

  for (const [persona, tabName, count] of [['solo', /Solo agent/, 3], ['owner', /Platform owner/, 5], ['finance', /Finance admin/, 1]]) {
    await page.context().clearCookies();
    await signIn(page, persona);
    await page.goto('/#/overview');
    await page.goto('/#/guide');
    await page.reload();
    await expect(page.getByRole('tab', { name: tabName })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab')).toHaveCount(count);
  }
  // Owner's guide links straight to the CRM monitor.
  await page.context().clearCookies();
  await signIn(page, 'owner');
  await page.goto('/#/guide');
  await page.reload();
  await page.locator('.gstation', { hasText: 'Monitor every CRM' }).click();
  await page.locator('.gdetail').getByRole('link', { name: 'Go there →' }).click();
  await expect(page.getByRole('heading', { name: 'CRM monitor' })).toBeVisible();
  expect(problems).toEqual([]);
});
