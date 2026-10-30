import { getDb } from '../server/db.js';
import { seedBase, seedDemo } from '../server/seed.js';

getDb();
seedBase();
seedDemo();
console.log('Seeded FICTIONAL demo data (DEMO personas, synthetic investors). Never run against production.');
