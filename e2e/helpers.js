import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Fictional test personas sign in through the test-only route of the E2E server
// (createApp({ testLogin: true })); the live portal has no such route. The browser
// context shares the session cookie, so tests start signed in.
export async function signIn(page, persona) {
  const res = await page.request.post('/api/test/login', { data: { persona }, headers: { 'x-aihome-csrf': '1' } });
  expect(res.ok(), `test sign-in as ${persona}`).toBeTruthy();
}

// Step-up MFA dialog. The E2E server's test-only route returns the current authenticator
// code of the signed-in owner/finance persona; the test types it like a person would.
export async function passMfa(page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Verify it’s you' })).toBeVisible();
  const { code } = await (await page.request.get('/api/test/totp')).json();
  await dialog.getByPlaceholder('123456').fill(code);
  await dialog.getByRole('button', { name: 'Verify' }).click();
  // The MFA window closes; the action it unlocked may open its own window right after.
  await expect(page.locator('#mfa-form')).toBeHidden();
}

export async function coldUsedToday(page) {
  const pill = page.getByTitle('resets at midnight Dubai');
  await expect(pill).toBeVisible();
  return Number((await pill.textContent()).match(/(\d[\d,]*)\s*\/\s*[\d,]+/)[1].replace(/,/g, ''));
}

// Playwright's test loader cannot load exceljs, so XLSX files are read in a plain Node
// process. Returns { sheets, title } for the downloaded owner export.
export function readXlsxSummary(file) {
  const script = `const E=require('exceljs');const w=new E.Workbook();w.xlsx.readFile(process.argv[1]).then(()=>{process.stdout.write(JSON.stringify({sheets:w.worksheets.map(s=>s.name),title:w.getWorksheet('Transactions').getRow(1).getCell(1).text}))})`;
  return JSON.parse(execFileSync(process.execPath, ['-e', script, file], { encoding: 'utf8' }));
}
