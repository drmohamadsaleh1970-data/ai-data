// Prints a new OWNER_TOTP_SECRET and the otpauth:// link to add it to an authenticator app.
// Usage: npm run owner-mfa-secret -- owner@example.com
import { newTotpSecret } from '../server/util.js';

const email = process.argv[2] || 'owner';
const secret = newTotpSecret();
console.log(`OWNER_TOTP_SECRET=${secret}`);
console.log(`Authenticator link: otpauth://totp/AI-DATA:${encodeURIComponent(email)}?secret=${secret}&issuer=AI-DATA`);
