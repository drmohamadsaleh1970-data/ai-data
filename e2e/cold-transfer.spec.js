import { test, expect } from '@playwright/test';
import { signIn, coldUsedToday } from './helpers.js';

test('investor search is masked, and a selected transfer is charged once and lands in the CRM', async ({ page }) => {
  await signIn(page, 'director');
  await page.goto('/#/investor-history');
  await expect(page.getByRole('heading', { name: 'Investor History' })).toBeVisible();
  const usedBefore = await coldUsedToday(page);

  await page.getByLabel('Client role').selectOption('BUYER');
  await page.getByLabel('Area / community').selectOption('Dubai Marina');
  // Only investors with a known email, so the CRM check at the end does not depend on
  // which fictional records happen to come first.
  await page.getByLabel('Email known').check();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Area: Dubai Marina')).toBeVisible();

  // Subscribers never get raw contact data or an export button.
  const table = page.getByRole('table');
  await expect(table).toContainText('•••');
  await expect(table).not.toContainText('@example.invalid');
  await expect(page.getByText('Raw exports are not available on subscriber plans.')).toBeVisible();
  await expect(page.getByRole('button', { name: /export|download/i })).toHaveCount(0);

  const selectable = page.getByRole('checkbox', { name: 'Select', exact: true, disabled: false });
  for (let i = 0; i < 3; i++) await selectable.nth(i).check();
  await page.getByRole('button', { name: 'Transfer selected to My CRM' }).click();

  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading', { name: /Confirm transfer/ })).toBeVisible();
  await confirm.getByLabel('Assign to').selectOption({ label: 'Round robin (agents)' });
  await confirm.getByLabel('Campaign / project tag').fill('e2e-marina');
  await confirm.getByRole('button', { name: 'Confirm transfer (3)' }).click();

  const result = page.getByRole('dialog');
  await expect(result.getByRole('heading', { name: /Transfer result/ })).toBeVisible();
  await expect(result).toContainText(`Today: ${usedBefore + 3} / 999 transferred`);

  await result.getByRole('link', { name: 'Open in CRM' }).click();
  await expect(page.getByRole('heading', { name: 'CRM' })).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'e2e-marina' }).first().click();
  await expect(page.getByText('Historical investor record — NOT verified as a new/current inquiry')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Historical transactions/ })).toBeVisible();
  // After a lawful transfer the CRM shows the real contact details to the team.
  await expect(page.getByText(/@example\.invalid/).first()).toBeVisible();
  expect(await coldUsedToday(page)).toBe(usedBefore + 3);
});
