import { test, expect } from '@playwright/test';
import { signIn, passMfa, coldUsedToday } from './helpers.js';

// Full customer journeys, start to end, through the real screens:
// sign-in details → (Google, replaced by the test sign-in here) → profile → organization →
// offline payment → owner confirms in Payment approvals → customer activates with the
// automatic code → team invite with a personal limit → agent works within that limit.
// Any JavaScript error or failed API call on the way fails the test.

const shots = 'test-results/journey';

// Each journey walks through a dozen screens with three people.
test.setTimeout(180_000);

function watch(page, label) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`${label} page error: ${e.message}`));
  // 4xx answers are part of the journey (a wrong mobile number is refused, the owner is
  // asked for MFA); server errors and script errors are not.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|gsi\/client|accounts\.google/.test(m.text())) problems.push(`${label} console: ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`${label} ${r.status()} ${r.url()}`); });
  return problems;
}

async function detailsStep(page, roleText, { name, phone, email }) {
  await page.goto('/#/signin');
  await page.getByRole('button', { name: roleText }).click();
  // A wrong mobile number is caught before Google opens.
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Mobile number').fill('12');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/mobile number with country code/i)).toBeVisible();
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(email)).toBeVisible();
}

async function completeProfile(page, { name, phone }) {
  await page.goto('/#/overview');
  await expect(page.getByRole('heading', { name: 'Complete your profile' })).toBeVisible();
  // Nothing else is reachable until the profile is complete.
  await page.goto('/#/billing');
  await expect(page.getByRole('heading', { name: 'Complete your profile' })).toBeVisible();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Profile saved ✓')).toBeVisible();
}

async function createOrgAndPay(page, { orgName, planLabel, planCode }) {
  await expect(page.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
  await page.getByText(planLabel).click();
  await page.getByLabel('Agency / account name').fill(orgName);
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  page.once('dialog', (d) => d.accept('Bank transfer from journey test'));
  await page.locator(`[data-act=pay-cash][data-plan=${planCode}]`).click();
  const toast = page.getByText(/Payment reference AIH-\w+ — pending verification/);
  await expect(toast).toBeVisible();
  const ref = (await toast.textContent()).match(/AIH-\w+/)[0];
  await expect(page.getByText(/Waiting for AI-DATA to confirm your payment/)).toBeVisible();
  return ref;
}

async function ownerConfirms(owner, ref, customerEmail) {
  await owner.goto('/#/owner');
  await owner.getByRole('link', { name: /waiting for your confirmation/ }).click();
  await expect(owner.getByRole('heading', { name: 'Payment approvals' })).toBeVisible();
  const form = owner.locator('form').filter({ hasText: ref });
  await expect(form).toContainText(customerEmail);
  await form.getByLabel('Receipt / transfer no.').fill(`BT-${ref}`);
  await form.getByRole('button', { name: /Confirm payment/ }).click();
  await passMfa(owner);
  const dialog = owner.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Payment confirmed ✓' })).toBeVisible();
  const code = (await dialog.locator('#act-link').textContent()).trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await dialog.getByRole('button', { name: 'Close' }).click();
  return code;
}

async function customerActivates(page, code, limit) {
  await page.goto('/#/overview');
  await page.reload(); // the customer comes back later: a fresh page load

  await page.getByRole('link', { name: /Payment confirmed/ }).click();
  await expect(page.getByLabel('Activation code')).toHaveValue(code);
  await page.getByRole('button', { name: 'Activate now' }).click();
  await expect(page.getByText('Subscription activated ✓')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByTitle('resets at midnight Dubai')).toContainText(new RegExp(`0 / ${limit}`));
}

test('agency: sign-up → payment → owner approval → activation → invite agent with a daily limit → agent works within it', async ({ browser }) => {
  const dCtx = await browser.newContext(); const oCtx = await browser.newContext(); const aCtx = await browser.newContext();
  const director = await dCtx.newPage(); const owner = await oCtx.newPage(); const agent = await aCtx.newPage();
  const problems = [];
  const p1 = watch(director, 'director'), p2 = watch(owner, 'owner'), p3 = watch(agent, 'agent');

  // 1. Sign-in page: account type + details (Google itself is replaced by the test sign-in).
  await detailsStep(director, /Run an agency/, { name: 'Huda Al Falasi', phone: '050 111 2233', email: 'fresh.agency@journey.example' });
  await director.screenshot({ path: `${shots}/agency-1-signin-details.png`, fullPage: true });
  await signIn(director, 'fresh-agency');

  // 2. Profile, organization, offline payment.
  await completeProfile(director, { name: 'Huda Al Falasi', phone: '050 111 2233' });
  await director.screenshot({ path: `${shots}/agency-2-onboarding.png`, fullPage: true });
  const ref = await createOrgAndPay(director, { orgName: 'Falasi Properties (JOURNEY)', planLabel: /^Agency · /, planCode: 'AGENCY_MONTHLY' });
  await director.screenshot({ path: `${shots}/agency-3-waiting-payment.png`, fullPage: true });
  // No data access before the payment is confirmed.
  await director.goto('/#/overview');
  await expect(director.getByText('No active Cold subscription').first()).toBeVisible();

  // 3. Owner confirms in Payment approvals.
  await signIn(owner, 'owner');
  const code = await ownerConfirms(owner, ref, 'fresh.agency@journey.example');
  await owner.screenshot({ path: `${shots}/agency-4-owner-approvals.png`, fullPage: true });

  // 4. Director activates with the code that arrived automatically.
  await customerActivates(director, code, 999);
  await director.screenshot({ path: `${shots}/agency-5-active.png`, fullPage: true });

  // 5. Invite an agent with name, mobile and a personal limit of 2 a day.
  await director.goto('/#/team');
  const invite = director.locator('form[data-form=invite]');
  await invite.getByLabel('Full name').fill('Omar Haddad');
  await invite.getByLabel('Mobile number').fill('+971 52 444 5566');
  await invite.getByLabel('Email').fill('fresh.agent@journey.example');
  await invite.getByLabel('Role').selectOption('AGENT');
  await invite.getByLabel('Daily limit (records)').fill('2');
  await invite.getByRole('button', { name: 'Add agent' }).click();
  await expect(director.getByText(/Agent added ✓/)).toBeVisible();
  await expect(director.getByText('2/day')).toBeVisible();

  // 6. Agent signs in, confirms the pre-filled profile, sees the personal limit.
  await signIn(agent, 'fresh-agent');
  await agent.goto('/#/overview');
  await expect(agent.getByRole('heading', { name: 'Complete your profile' })).toBeVisible();
  await expect(agent.getByLabel('Mobile number')).toHaveValue('+971524445566');
  await expect(agent.getByLabel('Full name')).toHaveValue('Omar Haddad');
  await agent.getByRole('button', { name: 'Save and continue' }).click();
  await expect(agent.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(agent.getByTitle('Your personal daily limit')).toContainText('you 0/2');

  // 7. Agent selects 3 records: only 2 fit the personal limit.
  await agent.goto('/#/investor-history');
  await agent.getByRole('button', { name: 'Search', exact: true }).click();
  const selectable = agent.getByRole('checkbox', { name: 'Select', exact: true, disabled: false });
  for (let i = 0; i < 3; i++) await selectable.nth(i).check();
  await agent.getByRole('button', { name: 'Transfer selected to My CRM' }).click();
  const confirm = agent.getByRole('dialog');
  await expect(confirm).toContainText('Your personal daily limit');
  await expect(confirm.getByText(/Only 2 of 3 new records fit/)).toBeVisible();
  await agent.screenshot({ path: `${shots}/agency-6-agent-limit.png`, fullPage: true });
  await confirm.locator('#tr-partial').check();
  await confirm.getByRole('button', { name: 'Confirm transfer (2)' }).click();
  const result = agent.getByRole('dialog');
  await expect(result.getByRole('heading', { name: /Transfer result/ })).toBeVisible();
  await expect(result).toContainText('Personal daily limit reached');
  await result.getByRole('link', { name: 'Open in CRM' }).first().click();
  await expect(agent.getByRole('heading', { name: 'CRM' })).toBeVisible();

  // 8. Director sees the agent's usage on the Team page (clicking the menu item refreshes it).
  await director.goto('/#/team');
  await director.getByRole('link', { name: /Teams & Agents/ }).click();
  await expect(director.getByLabel('Daily limit for Omar Haddad')).toHaveValue('2');
  await expect(director.locator('form[data-form=member-cap]').filter({ has: director.getByLabel('Daily limit for Omar Haddad') })).toContainText('2 today');
  await director.screenshot({ path: `${shots}/agency-7-team.png`, fullPage: true });
  expect(await coldUsedToday(director)).toBe(2);

  problems.push(...p1, ...p2, ...p3);
  expect(problems, problems.join('\n')).toEqual([]);
  await dCtx.close(); await oCtx.close(); await aCtx.close();
});

test('solo agent: sign-up → payment → owner approval → activation with 99 a day', async ({ browser }) => {
  const sCtx = await browser.newContext(); const oCtx = await browser.newContext();
  const solo = await sCtx.newPage(); const owner = await oCtx.newPage();
  const p1 = watch(solo, 'solo'), p2 = watch(owner, 'owner');

  await detailsStep(solo, /Work on your own/, { name: 'Rania Saad', phone: '+44 7700 900123', email: 'fresh.solo@journey.example' });
  await signIn(solo, 'fresh-solo');
  await completeProfile(solo, { name: 'Rania Saad', phone: '+44 7700 900123' });
  const ref = await createOrgAndPay(solo, { orgName: 'Rania Saad Realty (JOURNEY)', planLabel: /^Agent · /, planCode: 'AGENT_MONTHLY' });

  await signIn(owner, 'owner');
  const code = await ownerConfirms(owner, ref, 'fresh.solo@journey.example');
  await customerActivates(solo, code, 99);
  await solo.screenshot({ path: `${shots}/solo-active.png`, fullPage: true });

  // The profile page shows the saved details.
  await solo.goto('/#/profile');
  await expect(solo.getByLabel('Mobile number')).toHaveValue('+447700900123');

  const problems = [...p1, ...p2];
  expect(problems, problems.join('\n')).toEqual([]);
  await sCtx.close(); await oCtx.close();
});

test('agent in an agency: chooses the agency by name, asks to join, the director approves with a limit', async ({ browser }) => {
  const aCtx = await browser.newContext(); const dCtx = await browser.newContext();
  const agent = await aCtx.newPage(); const director = await dCtx.newPage();
  const p1 = watch(agent, 'agent'), p2 = watch(director, 'director');

  // Sign-in page: "Agent in an agency" → agency first → name not listed → details.
  await agent.goto('/#/signin');
  await agent.getByRole('button', { name: /Work under your agency/ }).click();
  await agent.getByLabel('Your agency').fill('Nowhere Realty');
  await agent.getByRole('button', { name: 'Continue' }).click();
  await expect(agent.getByText(/No agency with that name/)).toBeVisible();
  await agent.getByLabel('Your agency').fill('Marina Crest Realty (TEST)');
  await agent.getByRole('button', { name: 'Continue' }).click();
  await expect(agent.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await agent.getByRole('button', { name: /My name isn't listed/ }).click();
  await agent.getByLabel('Full name').fill('Sami Nasser');
  await agent.getByLabel('Mobile number').fill('055 333 4444');
  await agent.getByLabel('Email').fill('fresh.joiner@journey.example');
  await agent.getByRole('button', { name: 'Continue' }).click();
  await expect(agent.locator('.kv')).toContainText('Marina Crest Realty (TEST)');
  await expect(agent.locator('.kv')).toContainText('approves your request');
  await agent.screenshot({ path: `${shots}/join-1-signin.png`, fullPage: true });

  // Google sign-in (test sign-in here), profile, then the join page.
  await signIn(agent, 'fresh-joiner');
  await completeProfile(agent, { name: 'Sami Nasser', phone: '055 333 4444' });
  await expect(agent.getByRole('heading', { name: 'Join your agency' })).toBeVisible();
  await agent.getByLabel('Your agency').fill('Marina Crest Realty (TEST)');
  await agent.getByRole('button', { name: 'Ask to join' }).click();
  await expect(agent.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
  await expect(agent.getByText(/You asked to join Marina Crest Realty \(TEST\)/)).toBeVisible();

  // Director: banner → Team → approve as Agent with 3 a day.
  await signIn(director, 'director');
  await director.goto('/#/overview');
  await director.getByRole('link', { name: /asked to join your agency/ }).click();
  const req = director.locator('form[data-form=join-approve]').filter({ hasText: 'Sami Nasser' });
  await expect(req).toContainText('+971553334444');
  await req.getByLabel('Daily limit for Sami Nasser').fill('3');
  await req.getByRole('button', { name: 'Approve' }).click();
  await expect(director.getByText('Approved ✓')).toBeVisible();
  await expect(director.getByLabel('Daily limit for Sami Nasser')).toHaveValue('3');

  // Agent: Check again → the agency workspace with the personal limit.
  await agent.getByRole('button', { name: 'Check again' }).click();
  await expect(agent.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(agent.getByText('Marina Crest Realty (TEST)').first()).toBeVisible();
  await expect(agent.getByTitle('Your personal daily limit')).toContainText('you 0/3');

  const problems = [...p1, ...p2];
  expect(problems, problems.join('\n')).toEqual([]);
  await aCtx.close(); await dCtx.close();
});

test('agent added by the agency picks their name on the sign-in page and joins without approval', async ({ browser }) => {
  const dCtx = await browser.newContext(); const aCtx = await browser.newContext();
  const director = await dCtx.newPage(); const agent = await aCtx.newPage();
  const p1 = watch(director, 'director'), p2 = watch(agent, 'agent');

  await signIn(director, 'director');
  await director.goto('/#/team');
  const add = director.locator('form[data-form=invite]');
  await add.getByLabel('Full name').fill('Layla Haddad');
  await add.getByLabel('Mobile number').fill('050 909 0909');
  await add.getByLabel('Email').fill('fresh.joiner2@journey.example');
  await add.getByLabel('Daily limit (records)').fill('4');
  await add.getByRole('button', { name: 'Add agent' }).click();
  await expect(director.getByText(/Agent added ✓/)).toBeVisible();

  await agent.goto('/#/signin');
  await agent.getByRole('button', { name: /Work under your agency/ }).click();
  await agent.getByLabel('Your agency').fill('Marina Crest Realty (TEST)');
  await agent.getByRole('button', { name: 'Continue' }).click();
  // The list shows a short name and an email hint only.
  const me = agent.getByRole('button', { name: /Layla H\./ });
  await expect(me).toContainText('f•••@journey.example');
  await expect(agent.getByText('050 909 0909')).toHaveCount(0);
  await me.click();
  await agent.getByLabel('Full name').fill('Layla Haddad');
  await agent.getByLabel('Mobile number').fill('050 909 0909');
  // A different email than the agency added is refused before Google opens.
  await agent.getByLabel('Email').fill('someone.else@journey.example');
  await agent.getByRole('button', { name: 'Continue' }).click();
  await expect(agent.getByText(/added this name with the email f•••@journey.example/)).toBeVisible();
  await agent.getByLabel('Email').fill('fresh.joiner2@journey.example');
  await agent.getByRole('button', { name: 'Continue' }).click();
  await expect(agent.locator('.kv')).toContainText('you join straight away');

  await signIn(agent, 'fresh-joiner2');
  await agent.goto('/#/overview');
  await agent.reload();
  await agent.getByRole('button', { name: 'Save and continue' }).click();
  await expect(agent.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(agent.getByText('Marina Crest Realty (TEST)').first()).toBeVisible();
  await expect(agent.getByTitle('Your personal daily limit')).toContainText('you 0/4');

  const problems = [...p1, ...p2];
  expect(problems, problems.join('\n')).toEqual([]);
  await dCtx.close(); await aCtx.close();
});
