// Vercel serverless entry. Static files in public/ are served by Vercel's CDN; every
// /api/* request is rewritten here (see vercel.json) and handled by the Express app.
//
// Storage: set DATABASE_URL (Supabase / any PostgreSQL) so sessions, CRM records and
// payments are shared by every instance and survive restarts. Without it the app falls
// back to a SQLite file in /tmp, which is per-instance and wiped on cold starts - users
// get signed out at random and data disappears. See README "Deploying to Vercel".
let ready;
let lastSweep = 0;

async function init() {
  if (!process.env.DATABASE_URL) console.warn('[db] DATABASE_URL is not set: using temporary /tmp storage that is lost on every cold start');
  process.env.DB_FILE ||= '/tmp/aihome.db';
  process.env.EXPORT_DIR ||= '/tmp/exports';
  const { getDb } = await import('../server/db.js');
  const { seedBase, ensureOwner } = await import('../server/seed.js');
  const { createApp } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const crm = await import('../server/crm.js');
  getDb();
  seedBase();
  ensureOwner();
  if (config.demoMode) (await import('../server/demo.js')).seedDemo();
  return { app: createApp(), runSlaSweep: crm.runSlaSweep };
}

export default async function handler(req, res) {
  ready ??= init();
  const { app, runSlaSweep } = await ready;
  // No long-running worker on serverless: run the SLA sweep at most once a minute,
  // piggy-backing on incoming requests (it is idempotent per escalation level).
  if (Date.now() - lastSweep > 60_000) {
    lastSweep = Date.now();
    try { runSlaSweep(); } catch (err) { console.error('[sla] sweep failed', err); }
  }
  return app(req, res);
}
