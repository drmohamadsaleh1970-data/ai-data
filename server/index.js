import { createApp } from './app.js';
import { config } from './config.js';
import { getDb } from './db.js';
import { seedBase, ensureOwner } from './seed.js';
import { runSlaSweep } from './crm.js';
import { syncFromApi } from './source-aihome.js';

getDb();
seedBase();
ensureOwner();
const app = createApp();
app.listen(config.port, () => {
  console.log(`AI-DATA portal on ${config.baseUrl}`);
});

// SLA escalation worker. In production run this in a separate worker process
// (or BullMQ repeatable job); it is idempotent per escalation level.
setInterval(() => {
  try {
    const r = runSlaSweep();
    if (r.notifications) console.log(`[sla] escalations sent: ${r.notifications}`);
  } catch (err) {
    console.error('[sla] sweep failed', err);
  }
}, 60_000).unref();

// Optional scheduled pull of investor data from ai-home.world.
if (config.aihomeSource.url && config.aihomeSource.syncMinutes > 0) {
  setInterval(async () => {
    try {
      const r = await syncFromApi();
      console.log(`[aihome-sync] ${r.transactions_created} new, ${r.transactions_updated} updated, ${r.rejected} rejected`);
    } catch (err) {
      console.error('[aihome-sync] failed', err.message);
    }
  }, config.aihomeSource.syncMinutes * 60_000).unref();
}
