import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

// CRM dashboard through the real screens, for every role:
// agency director (whole agency + drill into an agent), agent (own leads only),
// solo agent (own account), and the platform owner's CRM monitor (all accounts,
// masked lead list, open a lead, move it and reassign it).
test.setTimeout(150_000);

function watch(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
  return problems;
}

async function hotLead(page, name, phone) {
  const r = await page.request.post('/api/public/inquiry', {
    headers: { 'x-site-key': 'marinacrest-test-site' },
    data: { full_name: name, phone, consent_contact: true, consent_marketing: true, area: 'Dubai Marina', client_event_id: `${name}-${Date.now()}` },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).lead_id;
}

test('agency director: dashboard, preferences on a lead, team drill-down', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, 'director');
  const leadId = await hotLead(page, 'Dash Client (TEST)', '0505551201');

  // Record how the client wants to be contacted, and log a call.
  await page.goto(`/#/crm/lead/${leadId}`);
  await page.getByLabel('Channel').selectOption('WHATSAPP');
  await page.getByLabel('Best time').selectOption('EVENING');
  await page.getByLabel('Tone').selectOption('FRIENDLY');
  await page.getByLabel('Client language').selectOption('ar');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Saved ✓')).toBeVisible();
  await expect(page.getByLabel('Channel')).toHaveValue('WHATSAPP');
  await page.locator('[data-form=lead-activity] select[name=type]').selectOption('CALL_LOGGED');
  await page.locator('[data-form=lead-activity] textarea').fill('Talked about 2BR options');
  await page.getByRole('button', { name: 'Log activity' }).click();

  await page.getByRole('link', { name: 'CRM dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'CRM dashboard' })).toBeVisible();
  await expect(page.locator('.page-head p')).toContainText('Whole agency');
  for (const h of ['Pipeline', 'Follow-ups', 'How clients want to be contacted', 'Message templates']) await expect(page.getByRole('heading', { name: h })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Team · last 30 days/ })).toBeVisible();
  const evening = page.locator('.hbar').filter({ hasText: 'Evening' });
  await expect(evening.locator('.v')).toHaveText('1');

  // Period filter and drill into one agent.
  await page.getByLabel('Period').selectOption('7');
  await expect(page).toHaveURL(/days=7/);
  await expect(page.locator('.page-head p')).toContainText('last 7 days');
  await page.getByRole('row').filter({ hasText: 'Aisha Agent' }).click();
  await expect(page.locator('.page-head p')).toContainText('Agent: Aisha Agent (TEST)');
  await page.getByLabel('Show').selectOption('');
  await expect(page.locator('.page-head p')).toContainText('Whole agency');
  expect(problems).toEqual([]);
});

test('agent sees only their own dashboard; solo agent sees their account', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, 'agent1');
  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: 'CRM dashboard' })).toBeVisible();
  await expect(page.locator('.page-head p')).toContainText('Your leads');
  await expect(page.getByLabel('Show')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /^Team ·/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'CRM monitor' })).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, 'solo');
  await page.goto('/#/overview');
  await page.getByRole('link', { name: 'CRM dashboard' }).click();
  await expect(page.locator('.page-head p')).toContainText('Your account');
  await expect(page.getByText('Sam Solo Properties (TEST)').first()).toBeVisible();
  await page.goto('/#/owner/crm');
  await expect(page.getByText('Platform owner only.')).toBeVisible();
  expect(problems).toEqual([]);
});

test('platform owner: CRM monitor across agencies and solo agents, open, move and reassign a lead', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, 'director');
  await hotLead(page, 'Owner Watch (TEST)', '0505551202');
  await page.context().clearCookies();

  await signIn(page, 'owner');
  await page.goto('/#/owner');
  await page.getByRole('link', { name: 'CRM monitor' }).click();
  await expect(page.getByRole('heading', { name: 'CRM monitor' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Sam Solo Properties (TEST)' })).toContainText('Solo agent');
  await page.getByRole('row').filter({ hasText: 'Marina Crest Realty (TEST)' }).getByRole('link').click();
  await expect(page.getByText('You are viewing this account as platform owner')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Team · last/ })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: 'Owner Watch (TEST)' }).filter({ has: page.getByRole('button', { name: 'Open' }) });
  await expect(row).toContainText('•••');
  await row.getByRole('button', { name: 'Open' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('+971505551202')).toBeVisible();
  await dialog.getByLabel('Stage').selectOption('QUALIFIED');
  await expect(page.getByText(/Saved ✓/)).toBeVisible();
  await expect(dialog.getByText('Platform owner: ')).toBeVisible();
  await dialog.getByLabel('Assignee').selectOption({ label: 'Aisha Agent (TEST) (Agent)' });
  await expect(dialog.getByText('Platform owner assigned this lead to Aisha Agent (TEST)')).toBeVisible();
  await expect(dialog.getByLabel('Assignee')).toHaveValue(/\d+/);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // The solo agent's account is reachable for the owner too.
  await page.goto('/#/owner/crm');
  await page.getByRole('row').filter({ hasText: 'Sam Solo Properties (TEST)' }).getByRole('link').click();
  await expect(page.locator('.page-head p')).toContainText('Solo agent account');
  expect(problems).toEqual([]);
});
