import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

test('Arabic switches the whole app to right-to-left', async ({ page }) => {
  // Team Leader persona is used only here, because the chosen language is saved to the user.
  await signIn(page, 'leader');
  await page.goto('/#/overview');
  await page.getByLabel('Language').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('link', { name: 'سجل المستثمرين' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'نظرة عامة' })).toBeVisible();

  await page.getByLabel('اللغة').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('a subscriber session cannot reach raw-export or owner endpoints, even calling the API directly', async ({ request }) => {
  const login = await request.post('/api/test/login', { data: { persona: 'agent2' }, headers: { 'x-aihome-csrf': '1' } });
  expect(login.ok()).toBeTruthy();
  for (const url of ['/api/investor-history/export?scope=ALL', '/api/cold/export/xlsx', '/api/crm/dump']) {
    expect((await request.get(url)).status(), url).toBe(403);
  }
  const owner = await request.post('/api/owner/cold-exports', { data: { filter: {}, role: 'PLATFORM_OWNER' }, headers: { 'x-aihome-csrf': '1' } });
  expect(owner.status()).toBe(403);
});
