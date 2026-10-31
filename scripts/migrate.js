import { getDb, SCHEMA_VERSION } from '../server/db.js';
import { seedBase, ensureOwner } from '../server/seed.js';

getDb();
seedBase();
ensureOwner();
console.log(`Schema v${SCHEMA_VERSION} applied; reference data (plans, sources, flags) seeded.`);
