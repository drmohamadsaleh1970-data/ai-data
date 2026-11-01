import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

test('landing page shows both Cold plans and Hot Leads as separately priced', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/DEMO/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Know who bought before. Reach who is asking now.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agency', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agent', exact: true })).toBeVisible();
  await expect(page.getByText('AED 999', { exact: true })).toBeVisible();
  await expect(page.getByText('AED 99', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hot Leads (priced separately)' })).toBeVisible();
  await expect(page.getByText('Owner configuration required')).toBeVisible();
});

test('sign-in offers only Google (no demo personas); a signed-in director sees the shared quota', async ({ page }) => {
  await page.goto('/#/signin');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // Step 1 account type, step 2 details (name, mobile, email), then Google.
  await page.getByRole('button', { name: /Run an agency/ }).click();
  await page.getByLabel('Full name').fill('Sara Al Mansouri');
  await page.getByLabel('Mobile number').fill('0501234567');
  await page.getByLabel('Email').fill('sara@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('+971501234567')).toBeVisible();
  // Google sign-in is honestly reported as not connected in this environment.
  await expect(page.getByText('Google sign-in is NOT CONNECTED')).toBeVisible();
  await expect(page.getByText(/persona/i)).toHaveCount(0);
  await signIn(page, 'director');
  await page.goto('/#/overview');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Marina Crest Realty (TEST)').first()).toBeVisible();
  await expect(page.getByTitle('resets at midnight Dubai')).toContainText(/\d+ \/ 999/);
});

test('agency director sees mobile numbers and sets a personal daily limit for a team member', async ({ page }) => {
  await signIn(page, 'director');
  await page.goto('/#/team');
  await expect(page.getByRole('columnheader', { name: 'Mobile' })).toBeVisible();
  await expect(page.getByText('Account limit: 999 / day')).toBeVisible();
  const cap = page.getByLabel('Daily limit for Aisha Agent (TEST)');
  await cap.fill('25');
  await cap.locator('xpath=..').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Daily limit saved')).toBeVisible();
  await expect(page.getByLabel('Daily limit for Aisha Agent (TEST)')).toHaveValue('25');
  // Invitations carry name, mobile and limit.
  await expect(page.getByRole('heading', { name: 'Invite' })).toBeVisible();
  await expect(page.locator('form[data-form=invite]').getByLabel('Daily limit (records)')).toBeVisible();
});
