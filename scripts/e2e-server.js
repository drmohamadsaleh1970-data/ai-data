// Starts the portal for Playwright with a fresh, FICTIONAL demo database on port 3100.
import fs from 'node:fs';

process.env.DB_FILE = '.e2e-data/e2e.db';
process.env.EXPORT_DIR = '.e2e-data/exports';
process.env.DEMO_MODE = 'true';
process.env.PORT ||= '3100';
process.env.BASE_URL ||= `http://localhost:${process.env.PORT}`;
fs.rmSync('.e2e-data', { recursive: true, force: true });
await import('./seed.js');
await import('../server/index.js');
