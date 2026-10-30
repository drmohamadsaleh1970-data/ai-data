import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Demo personas (DEMO_MODE only) sign in through the API; the browser context shares
// the session cookie, so tests start signed in without clicking through the login page.
export async function signIn(page, persona) {
  const res = await page.request.post('/api/auth/demo', { data: { persona }, headers: { 'x-aihome-csrf': '1' } });
  expect(res.ok(), `demo sign-in as ${persona}`).toBeTruthy();
}

// Step-up MFA dialog. In DEMO mode the server exposes the current TOTP code to the
// signed-in owner/finance persona through the "DEMO: fill code" button.
export async function passMfa(page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Verify it’s you' })).toBeVisible();
  await dialog.getByRole('button', { name: 'DEMO: fill code' }).click();
  await expect(dialog.getByPlaceholder('123456')).toHaveValue(/^\d{6}$/);
  await dialog.getByRole('button', { name: 'Verify' }).click();
  await expect(dialog).toBeHidden();
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
