import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import ExcelJS from 'exceljs';
import { startTestServer, client, key } from './helpers.js';

// Fictional rows shaped like the ai-home.world investor-history table.
const HEADERS = ['Country', 'City', 'AreaNameEn', 'PropertyTypeEn', 'Client Role', 'Client name', 'NATIONALITY', 'Master Developer', 'Project Name', 'Size(M2)', 'Price/ProcedureValue', 'price/sqft', 'Registration_Date', 'Mobile', 'Email'];
const ROWS = [
  ['UAE', 'Dubai', 'Zeta Bay (TEST)', 'Apartment', 'Buyer', 'Testa Importer', 'Fictional', 'Dev One', 'Tower Q (TEST)', '101.5', '1,850,000', '1700', '14/03/2021', '050 700 0001', ''],
  ['UAE', 'Dubai', 'Zeta Bay (TEST)', 'Villa', 'Seller', 'Testa Importer', 'Fictional', 'Dev One', 'Villas R (TEST)', '410', '7,200,000', '1600', '2023-08-02', '+971507000001', 'testa@example.invalid'],
  ['UAE', 'Dubai', 'Zeta Bay (TEST)', 'Apartment', 'Buyer', 'Same Name (TEST)', 'Fictional', 'Dev One', 'Tower Q (TEST)', '80', '1,200,000', '1390', '01/02/2020', '', ''],
  ['UAE', 'Dubai', 'Zeta Bay (TEST)', 'Apartment', 'Buyer', 'Same Name (TEST)', 'Fictional', 'Dev One', 'Tower Q (TEST)', '95', '1,400,000', '1370', '05/06/2022', '', ''],
  ['UAE', 'Dubai', 'Zeta Bay (TEST)', 'Apartment', 'Lessee', 'Bad Role (TEST)', 'Fictional', 'Dev One', 'Tower Q (TEST)', '70', '900,000', '1190', 'not a date', '', ''],
];

async function xlsxBase64(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Investor History');
  ws.addRow(['Investor Intelligence export']); // title row above the header, as exports often have
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

let srv, mock, mockUrl, db;
const API_TOKEN = 'test-source-token';
before(async () => {
  // Mock ai-home.world API: two pages of fictional rows, Bearer token required.
  mock = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${API_TOKEN}`) { res.writeHead(401); return res.end(); }
    const page = Number(new URL(req.url, 'http://x').searchParams.get('page') || 1);
    const mk = (i) => ({ TransactionNumber: `API-${i}`, Country: 'UAE', City: 'Abu Dhabi', AreaNameEn: 'Api Island (TEST)', PropertyTypeEn: 'Townhouse', 'Client Role': i % 2 ? 'Buyer' : 'Seller', 'Client name': `Api Person ${i} (TEST)`, Registration_Date: `2024-0${(i % 9) + 1}-10`, 'Price/ProcedureValue': 2000000 + i, Mobile: `05080000${String(i).padStart(2, '0')}` });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(page === 1 ? { rows: [1, 2, 3].map(mk), has_more: true } : { rows: [4, 5].map(mk), has_more: false }));
  }).listen(0);
  await new Promise((r) => mock.once('listening', r));
  mockUrl = `http://127.0.0.1:${mock.address().port}/api/investor-history`;
  srv = await startTestServer();
  db = (await import('../server/db.js')).getDb();
});
after(async () => { await srv.close(); mock.close(); });

test('preview maps ai-home.world columns and flags bad rows; import needs owner + MFA', async () => {
  const b64 = await xlsxBase64(HEADERS, ROWS);
  const sub = client(srv.base);
  await sub.login('director');
  assert.equal((await sub.post('/api/owner/source/preview', { file_base64: b64, file_name: 'ih.xlsx' })).status, 403);

  const o = client(srv.base);
  await o.login('owner');
  const pv = await o.post('/api/owner/source/preview', { file_base64: b64, file_name: 'ih.xlsx' });
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  assert.equal(pv.data.mapping['Client name'], 'full_name');
  assert.equal(pv.data.mapping['Price/ProcedureValue'], 'price_aed');
  assert.equal(pv.data.mapping.AreaNameEn, 'area');
  assert.equal(pv.data.mapping.Mobile, 'phone');
  assert.ok(!('price/sqft' in pv.data.mapping), 'derived column ignored');
  assert.equal(pv.data.valid, 4);
  assert.equal(pv.data.rejected, 1);
  assert.match(pv.data.sample_errors[0].errors.join(), /role/);
  assert.equal((await o.post('/api/owner/source/import', { file_base64: b64, file_name: 'ih.xlsx' })).data.error, 'MFA_REQUIRED');
});

test('import groups by phone/email only, never by name; re-import is idempotent; records start restricted', async () => {
  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  const b64 = await xlsxBase64(HEADERS, ROWS);
  const r1 = await o.post('/api/owner/source/import', { file_base64: b64, file_name: 'ih.xlsx' });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.transactions_created, 4);
  assert.equal(r1.data.investors_created, 3, 'Testa (same phone) = 1 investor; two "Same Name" rows stay separate');
  assert.equal(r1.data.rejected, 1);

  const testa = db.prepare("SELECT * FROM investor_contact WHERE full_name = 'Testa Importer'").all();
  assert.equal(testa.length, 1);
  assert.equal(testa[0].phone, '+971507000001');
  assert.equal(testa[0].email, 'testa@example.invalid', 'second row filled the missing email');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM investor_transaction WHERE investor_id = ?').get(testa[0].id).n, 2);
  const same = db.prepare("SELECT identity_confidence FROM investor_contact WHERE full_name = 'Same Name (TEST)'").all();
  assert.equal(same.length, 2);
  assert.ok(same.every((x) => x.identity_confidence === 'AMBIGUOUS'));
  const t = db.prepare("SELECT * FROM investor_transaction WHERE project = 'Tower Q (TEST)' AND investor_id = ?").get(testa[0].id);
  assert.equal(t.price_aed, 1850000);
  assert.equal(t.registration_date, '2021-03-14', 'day-first date');
  assert.ok(testa.every((x) => x.rights_status === 'RESTRICTED_PENDING_REVIEW'));

  const r2 = await o.post('/api/owner/source/import', { file_base64: b64, file_name: 'ih.xlsx' });
  assert.equal(r2.data.transactions_created, 0);
  assert.equal(r2.data.investors_created, 0);
  assert.equal(r2.data.transactions_updated, 4);
});

test('subscribers cannot see or transfer imported PII until the owner approves the source rights', async () => {
  const d = client(srv.base);
  await d.login('director');
  const find = async () => (await d.post('/api/cold/search', { filter: { area: ['Zeta Bay (TEST)'] } })).data;
  let res = await find();
  assert.equal(res.counts.total, 3);
  assert.equal(res.counts.eligible, 0);
  assert.ok(res.results.every((r) => r.name === null && r.phone === null));
  const id = res.results[0].id;
  const blocked = await d.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [id] } }, { 'idempotency-key': key() });
  assert.equal(blocked.data.items[0].reason, 'RIGHTS_PENDING_REVIEW');
  assert.equal(blocked.data.charged, 0);

  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  const prov = (await o.get('/api/owner/provenance')).data.find((p) => p.source_name === 'ai-home.world investor-history');
  await o.post(`/api/owner/provenance/${prov.id}/review`, { allow_transfer: true });
  res = await find();
  assert.equal(res.counts.eligible, 3);
  assert.ok(res.results.every((r) => r.name.includes('•')), 'still masked before transfer');
  const ok = await d.post('/api/cold/transfers', { selection: { mode: 'ids', ids: [id] } }, { 'idempotency-key': key() });
  assert.equal(ok.data.charged, 1);
});

test('CSV export with quoted thousands separators imports the same way', async () => {
  const csv = [HEADERS.join(','), ...ROWS.slice(0, 1).map((r) => r.map((v) => (/[,]/.test(v) ? `"${v}"` : v)).join(','))].join('\r\n')
    .replace('Testa Importer', 'Csv Person (TEST)').replace('050 700 0001', '050 700 0099').replace('Tower Q (TEST)', 'Csv Tower (TEST)');
  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  const r = await o.post('/api/owner/source/import', { file_base64: Buffer.from('﻿' + csv).toString('base64'), file_name: 'ih.csv' });
  assert.equal(r.data.transactions_created, 1, JSON.stringify(r.data));
  assert.equal(db.prepare("SELECT price_aed FROM investor_transaction WHERE project = 'Csv Tower (TEST)'").get().price_aed, 1850000);
});

test('API sync pulls all pages with the bearer token; NOT_CONNECTED when unset', async () => {
  const o = client(srv.base);
  await o.login('owner');
  await o.mfa();
  delete process.env.AIHOME_SOURCE_URL;
  assert.equal((await o.get('/api/owner/source')).data.api, 'NOT_CONNECTED');
  assert.equal((await o.post('/api/owner/source/sync')).data.error, 'AIHOME_SOURCE_NOT_CONNECTED');

  process.env.AIHOME_SOURCE_URL = mockUrl;
  process.env.AIHOME_SOURCE_TOKEN = 'wrong';
  assert.equal((await o.post('/api/owner/source/sync')).data.error, 'AIHOME_SOURCE_ERROR');
  process.env.AIHOME_SOURCE_TOKEN = API_TOKEN;
  const r = await o.post('/api/owner/source/sync');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.rows, 5);
  assert.equal(r.data.transactions_created, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM investor_transaction WHERE source_txn_id LIKE 'AIH-API-%'").get().n, 5);
  assert.equal((await o.post('/api/owner/source/sync')).data.transactions_created, 0, 'idempotent by source transaction ID');
  const status = (await o.get('/api/owner/source')).data;
  assert.equal(status.api, 'CONNECTED');
  assert.ok(status.jobs.length >= 4);
  delete process.env.AIHOME_SOURCE_URL;
});
