import { test, expect } from '@playwright/test';
import { signIn, passMfa } from './helpers.js';

test('offline payment stays pending until finance confirms it; the customer gets the activation code automatically', async ({ browser }) => {
  const customerCtx = await browser.newContext();
  const financeCtx = await browser.newContext();
  const customer = await customerCtx.newPage();
  const finance = await financeCtx.newPage();

  await signIn(customer, 'pending');
  await customer.goto('/#/billing');
  customer.once('dialog', (d) => d.accept('Paying at the Business Bay office (e2e)'));
  await customer.getByRole('button', { name: 'Pay cash / offline' }).first().click();
  const toast = customer.getByText(/Payment reference AIH-\w+ — pending verification/);
  await expect(toast).toBeVisible();
  const ref = (await toast.textContent()).match(/AIH-\w+/)[0];
  // The reference also appears later on the receipt row, so pin the request row by its plan.
  const requestRow = customer.getByRole('row').filter({ hasText: ref }).filter({ hasText: 'Agency monthly' });
  await expect(requestRow).toContainText('Pending payment');

  await signIn(finance, 'finance');
  await finance.goto('/#/overview');
  // The approver is pointed to the waiting payment from any page.
  await finance.getByRole('link', { name: /waiting for your confirmation/ }).click();
  await expect(finance.getByRole('heading', { name: 'Payment approvals' })).toBeVisible();
  const request = finance.locator('form').filter({ hasText: ref });
  await expect(request).toContainText('pending@palmgate.example');
  await expect(request.getByLabel('Amount received (AED)')).toHaveValue('999');
  await request.getByLabel('Paid on').fill('2026-10-30');
  await request.getByLabel('Receipt / transfer no.').fill(`E2E-${ref}`);
  await request.getByRole('button', { name: /Confirm payment/ }).click();
  await passMfa(finance);
  const dialog = finance.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Payment confirmed ✓' })).toBeVisible();
  await expect(dialog).toContainText('pending@palmgate.example');
  await expect(dialog).toContainText('Delivered automatically');
  const code = (await dialog.locator('#act-link').textContent()).trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(dialog.getByRole('link', { name: 'Also send by WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);

  // The customer gets the code without anyone forwarding it.
  await customer.goto('/#/overview');
  await expect(customer.getByRole('link', { name: /Payment confirmed/ })).toBeVisible();
  await customer.goto('/#/billing');
  await expect(customer.getByRole('heading', { name: /Payment confirmed — activate/ })).toBeVisible();
  await expect(customer.getByLabel('Activation code')).toHaveValue(code);
  await expect(requestRow).toContainText('Verified');
  await customer.getByRole('button', { name: 'Activate now' }).click();
  await expect(customer.getByText('Subscription activated ✓')).toBeVisible();
  await expect(customer.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await customerCtx.close();
  await financeCtx.close();
});
