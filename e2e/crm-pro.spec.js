import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

test.setTimeout(120_000);

async function leadsViaHotForm(page, n, prefix) {
  for (let i = 0; i < n; i++) {
    const r = await page.request.post('/api/public/inquiry', {
      headers: { 'x-site-key': 'marinacrest-test-site' },
      data: { full_name: `${prefix} ${i} (TEST)`, phone: `05055500${10 + i}`, consent_contact: true, consent_marketing: true, area: 'Dubai Marina', client_event_id: `${prefix}-${i}-${Date.now()}` },
    });
    expect(r.ok()).toBeTruthy();
  }
}

test('CRM: deal value and tags, bulk stage change, drag-and-drop pipeline, templates, My day', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'director');
  await leadsViaHotForm(page, 3, 'Pro Lead');

  // Lead page: deal, tags, a template message.
  await page.goto('/#/crm?q=Pro Lead 0');
  await page.getByRole('row').filter({ hasText: 'Pro Lead 0' }).first().click();
  await page.getByLabel('Deal value (AED)').fill('1800000');
  await page.getByLabel('Tags').fill('vip, marina');
  await page.getByRole('button', { name: 'Save deal' }).click();
  await expect(page.getByText('Saved ✓')).toBeVisible();
  await page.getByRole('button', { name: 'First contact (EN)' }).click();
  await expect(page.getByLabel('Message text')).toHaveValue(/Hello Pro, this is .+ Dubai Marina/);
  await expect(page.locator('#tpl-send')).toHaveText('Open in WhatsApp');

  // Lead list: filter by tag, then bulk-change the stage of all three.
  await page.goto('/#/crm?tag=vip');
  await expect(page.getByRole('row').filter({ hasText: 'Pro Lead 0' })).toContainText('AED');
  await page.goto('/#/crm?q=Pro Lead');
  await page.getByLabel('Select all leads').check();
  await expect(page.locator('#bulk-count')).toHaveText('3');
  await page.getByLabel('Set stage').selectOption('QUALIFIED');
  await page.getByRole('button', { name: 'Apply to selected' }).click();
  await expect(page.getByText('3 lead(s) updated ✓')).toBeVisible();

  // Pipeline: drag one card from Qualified to Viewing scheduled.
  await page.goto('/#/crm?view=pipeline&q=Pro Lead');
  await expect(page.getByText('Open pipeline value')).toBeVisible();
  await expect(page.locator('.kcol[data-stage=QUALIFIED] .kcard').filter({ hasText: 'Pro Lead 0' })).toBeVisible();
  // The board scrolls sideways, which a simulated mouse cannot do mid-drag; send the same
  // browser drag events a person's drag produces.
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.kcol[data-stage=QUALIFIED] .kcard')].find((c) => c.textContent.includes('Pro Lead 0'));
    const col = document.querySelector('.kcol[data-stage=VIEWING_SCHEDULED]');
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.getByText('Moved to Viewing scheduled ✓')).toBeVisible();
  await expect(page.locator('.kcol[data-stage=VIEWING_SCHEDULED]')).toContainText('Pro Lead 0');

  // My day and templates tabs render.
  await page.getByRole('link', { name: 'My day' }).click();
  await expect(page.getByRole('heading', { name: /^Overdue/ })).toBeVisible();
  await page.getByRole('link', { name: 'Templates' }).click();
  await page.getByLabel('Name').fill('Weekend open house');
  await page.getByLabel('Text').fill('Hi {name}, join our open house in {area} this weekend.');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Template saved ✓')).toBeVisible();
  await expect(page.getByText('Weekend open house')).toBeVisible();
  expect(errors).toEqual([]);
});

test('owner: per-user daily limit in any account, and deletion needs the typed phrase', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'owner');
  await page.goto('/#/owner');
  await page.getByRole('link', { name: /^Marina Crest/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Users and daily limits' })).toBeVisible();
  const cap = page.getByLabel('Daily limit for Leo Agent (TEST)');
  await cap.fill('15');
  await cap.locator('xpath=..').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Daily limit saved ✓')).toBeVisible();
  await expect(page.getByLabel('Daily limit for Leo Agent (TEST)')).toHaveValue('15');

  await page.getByRole('button', { name: 'Delete this account’s CRM data' }).click();
  const dialog = page.getByRole('dialog');
  const go = dialog.getByRole('button', { name: 'Delete this account’s CRM data' });
  await expect(go).toBeDisabled();
  await dialog.getByLabel('Confirmation phrase').fill('delete');
  await expect(go).toBeDisabled();
  await dialog.getByLabel('Confirmation phrase').fill('DELETE CRM DATA');
  await expect(go).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/#/owner/data');
  await expect(page.getByRole('button', { name: 'Delete all investor data' })).toBeVisible();
  expect(errors).toEqual([]);
});
