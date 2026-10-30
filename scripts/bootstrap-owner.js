// One-time, out-of-band owner bootstrap. Run on the server console; deliver the token
// to the owner through a separate channel. The owner signs in with Google (same email),
// opens Owner → Bootstrap, enters the token, and enrolls TOTP MFA.
import { getDb } from '../server/db.js';
import { randomToken, sha256 } from '../server/util.js';

const email = process.argv[process.argv.indexOf('--email') + 1];
if (!email || !email.includes('@')) { console.error('Usage: npm run bootstrap-owner -- --email owner@example.com'); process.exit(1); }
const db = getDb();
if (db.prepare("SELECT 1 FROM platform_user WHERE platform_role = 'PLATFORM_OWNER'").get()) { console.error('An owner already exists. Bootstrap refused.'); process.exit(1); }
const token = randomToken(24);
const expires = new Date(Date.now() + 30 * 60_000).toISOString();
db.prepare('INSERT INTO owner_bootstrap (token_hash, email, expires_at) VALUES (?,?,?)').run(sha256(token), email.toLowerCase(), expires);
console.log(`Owner bootstrap token for ${email} (expires ${expires}, single use):\n\n  ${token}\n`);
