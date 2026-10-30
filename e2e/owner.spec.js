import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { signIn, passMfa, readXlsxSummary } from './helpers.js';

test('owner sees unmasked data and can export XLSX only after MFA', async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/#/owner/data');
  await expect(page.getByRole('heading', { name: 'Master Cold database' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('@example.invalid');

  await page.getByRole('button', { name: /Export to Excel \(XLSX\)/ }).click();
  await passMfa(page);
  const download = page.getByRole('link', { name: 'Download XLSX' });
  await expect(download).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  expect(file.suggestedFilename()).toMatch(/^ai-data-investors-\d+\.xlsx$/);

  const xlsx = readXlsxSummary(await file.path());
  expect(xlsx.title).toContain('CONFIDENTIAL — AI-DATA owner export');
  expect(xlsx.sheets).toEqual(['Transactions', 'Manifest']);
});

test('owner imports an ai-home.world export: preview mapping, then import with MFA', async ({ page }, testInfo) => {
  // Fictional rows in the ai-home.world investor-history column layout (CSV export).
  const csv = [
    'Country,City,AreaNameEn,PropertyTypeEn,Client Role,Client name,NATIONALITY,Project Name,Size(M2),Price/ProcedureValue,Registration_Date,Mobile',
    'UAE,Dubai,E2E Creek (FICTIONAL),Apartment,Buyer,E2E Person One,Fictional,E2E Tower,90,"1,500,000",12/05/2022,050 900 0101',
    'UAE,Dubai,E2E Creek (FICTIONAL),Villa,Seller,E2E Person Two,Fictional,E2E Villas,420,"6,100,000",2023-03-01,',
    'UAE,Dubai,E2E Creek (FICTIONAL),Apartment,Tenant,E2E Bad Row,Fictional,E2E Tower,70,"900,000",n/a,',
  ].join('\r\n');
  const file = testInfo.outputPath('e2e-aihome-export.csv');
  fs.writeFileSync(file, csv);

  await signIn(page, 'owner');
  await page.goto('/#/owner/source');
  await expect(page.getByRole('heading', { name: 'ai-home.world data import' })).toBeVisible();
  await expect(page.getByText('NOT CONNECTED')).toBeVisible();

  await page.getByLabel('ai-home.world export file').setInputFiles(file);
  await page.getByRole('button', { name: 'Preview mapping' }).click();
  await expect(page.getByText('3 rows · 2 valid · 1 rejected · contact columns found')).toBeVisible();
  await expect(page.getByRole('row', { name: /Client name\s+full_name/ })).toBeVisible();

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await passMfa(page);
  await expect(page.getByText(/Imported: \d+ new transactions, \d+ new investors, \d+ updated, 1 rejected/)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'e2e-aihome-export.csv' }).first()).toBeVisible();
});
