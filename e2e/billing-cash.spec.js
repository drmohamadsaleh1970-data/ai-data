import { test, expect } from '@playwright/test';
import { signIn, passMfa } from './helpers.js';

test('offline payment stays pending until finance verifies it; the magic link activates once', async ({ browser }) => {
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
  await finance.goto('/#/owner/finance');
  const request = finance.locator('form').filter({ hasText: ref });
  await request.getByLabel('Amount received (USD)').fill('999');
  await request.getByLabel('Paid on').fill('2026-10-30');
  await request.getByLabel('Receipt no.').fill(`E2E-${ref}`);
  await request.getByRole('button', { name: 'Verify receipt & send activation link' }).click();
  await passMfa(finance);
  await expect(finance.getByText('Verified. Activation link sent to pending@palmgate.example')).toBeVisible();

  await customer.reload();
  await expect(requestRow).toContainText('Verified');
  await customer.getByRole('button', { name: 'Show my emails' }).click();
  const link = customer.getByRole('link', { name: /#\/activate\// }).first();
  const href = await link.getAttribute('href');
  await link.click();
  await expect(customer.getByRole('heading', { name: 'Activate subscription' })).toBeVisible();
  await customer.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(customer.getByText('Subscription activated ✓')).toBeVisible();
  await expect(customer.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // Single use: the same link is refused the second time.
  await customer.goto('/' + href);
  await customer.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(customer.getByText('Link already used')).toBeVisible();

  await customerCtx.close();
  await financeCtx.close();
});
