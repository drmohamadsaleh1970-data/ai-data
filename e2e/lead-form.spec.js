import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

test('owner creates a website key; the drop-in form on another site delivers a Hot lead to the agency CRM', async ({ page, browser, baseURL }) => {
  const label = `E2E agency site ${Date.now()}`;
  await signIn(page, 'owner');
  await page.goto('/#/owner/hot');
  await expect(page.getByRole('heading', { name: 'Website lead forms' })).toBeVisible();
  await page.getByLabel('Website name').fill(label);
  await page.getByLabel('Leads go to').selectOption({ label: 'Marina Crest Realty (TEST)' });
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  const key = (await (await page.request.get('/api/owner/hot')).json()).site_keys.find((k) => k.label === label).key;
  await expect(page.locator('.code', { hasText: key })).toContainText('lead-form.js');

  // A visitor on a different website (no AI-DATA session, different origin).
  const visitor = await browser.newPage();
  await visitor.setContent(`<!doctype html><html><body><h1>Partner site</h1>
    <div data-ai-data-form data-site-key="${key}" data-lang="en" data-privacy-url="https://example.invalid/privacy"></div>
    <script src="${baseURL}/lead-form.js"></script></body></html>`);
  const name = `E2E Web Visitor ${Date.now()}`;
  await visitor.getByLabel('Full name').fill(name);
  await visitor.getByLabel('Phone / WhatsApp').fill('050 777 8899');
  await visitor.getByLabel('Preferred area').fill('Dubai Marina');
  await visitor.getByRole('button', { name: 'Send enquiry' }).click();
  await expect(visitor.getByLabel('Full name')).toHaveValue(name, { timeout: 1000 }); // consent not ticked yet: nothing sent
  await visitor.getByLabel(/I agree to be contacted/).check();
  await visitor.getByRole('button', { name: 'Send enquiry' }).click();
  await expect(visitor.getByText('Thank you! An agent will contact you shortly.')).toBeVisible();
  await visitor.close();

  await signIn(page, 'director');
  await page.goto('/#/crm?source=HOT');
  // Wait for the CRM list itself (the owner's Hot page before it also has tables).
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
});
