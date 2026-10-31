// Starts the portal for Playwright on port 3100 with a fresh database holding FICTIONAL
// test fixtures and the test-only sign-in. Never used by the live portal.
import fs from 'node:fs';

process.env.DB_FILE = '.e2e-data/e2e.db';
process.env.EXPORT_DIR = '.e2e-data/exports';
process.env.PORT ||= '3100';
process.env.BASE_URL ||= `http://localhost:${process.env.PORT}`;
fs.rmSync('.e2e-data', { recursive: true, force: true });

const { getDb } = await import('../server/db.js');
const { seedBase } = await import('../server/seed.js');
const { seedFixtures } = await import('../test/fixtures.js');
const { createApp } = await import('../server/app.js');
getDb();
seedBase();
seedFixtures();
createApp({ testLogin: true }).listen(Number(process.env.PORT), () => console.log(`E2E server on ${process.env.BASE_URL}`));
