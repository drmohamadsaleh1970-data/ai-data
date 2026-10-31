import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

test('landing page shows both Cold plans and Hot Leads as separately priced', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/DEMO/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Know who bought before. Reach who is asking now.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agency', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agent', exact: true })).toBeVisible();
  await expect(page.getByText('US$999', { exact: true })).toBeVisible();
  await expect(page.getByText('US$99', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hot Leads (priced separately)' })).toBeVisible();
  await expect(page.getByText('Owner configuration required')).toBeVisible();
});

test('sign-in offers only Google (no demo personas); a signed-in director sees the shared quota', async ({ page }) => {
  await page.goto('/#/signin');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // Google sign-in is honestly reported as not connected in this environment.
  await expect(page.getByText('Google sign-in is NOT CONNECTED')).toBeVisible();
  await expect(page.getByText(/persona/i)).toHaveCount(0);
  await signIn(page, 'director');
  await page.goto('/#/overview');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Marina Crest Realty (TEST)').first()).toBeVisible();
  await expect(page.getByTitle('resets at midnight Dubai')).toContainText(/\d+ \/ 999/);
});
