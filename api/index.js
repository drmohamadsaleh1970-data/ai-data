// Vercel serverless entry. Static files in public/ are served by Vercel's CDN; every
// /api/* request is rewritten here (see vercel.json) and handled by the Express app.
//
// Storage: without a persistent database the SQLite file lives in /tmp, which is
// per-instance and wiped on cold starts. Reference data and the owner (from settings)
// are recreated on every start; everything else is lost until permanent storage is
// added — see README "Deploying to Vercel".
let ready;
let lastSweep = 0;

async function init() {
  process.env.DB_FILE ||= '/tmp/aihome.db';
  process.env.EXPORT_DIR ||= '/tmp/exports';
  const { getDb } = await import('../server/db.js');
  const { seedBase, ensureOwner } = await import('../server/seed.js');
  const { createApp } = await import('../server/app.js');
  const crm = await import('../server/crm.js');
  getDb();
  seedBase();
  ensureOwner();
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
