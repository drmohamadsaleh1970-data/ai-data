import { getDb, SCHEMA_VERSION } from '../server/db.js';
import { seedBase } from '../server/seed.js';

getDb();
seedBase();
console.log(`Schema v${SCHEMA_VERSION} applied; reference data (plans, sources, flags) seeded.`);
