// Outgoing email. Every message is written to email_outbox first (inside the same
// transaction as the event that caused it), then delivered after commit.
//
// Delivery uses Resend (https://resend.com) when RESEND_API_KEY and EMAIL_FROM are set.
// Without them messages stay QUEUED: the person still gets the same text as an in-app
// notification, and the owner can see what would have been sent.
import { getDb } from './db.js';
import { iso } from './util.js';

const env = process.env;
export const emailConfigured = () => !!(env.RESEND_API_KEY && env.EMAIL_FROM);

export function queueEmail(conn, { userId, to, subject, body }) {
  return Number(conn.prepare('INSERT INTO email_outbox (to_user_id, to_email, subject, body, status, created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, to, subject, body, 'QUEUED', iso()).lastInsertRowid);
}

// Sends queued messages. Never throws: a failed send is recorded and retried next time.
export async function deliverQueued({ limit = 20 } = {}) {
  if (!emailConfigured()) return { sent: 0, skipped: 'NOT_CONFIGURED' };
  const db = getDb();
  const rows = db.prepare("SELECT * FROM email_outbox WHERE status IN ('QUEUED','RETRY') ORDER BY id LIMIT ?").all(limit);
  let sent = 0;
  for (const m of rows) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to_email], subject: m.subject, text: m.body }),
        signal: AbortSignal.timeout(10_000),
      });
      db.prepare('UPDATE email_outbox SET status = ? WHERE id = ?').run(res.ok ? 'SENT' : (res.status >= 500 ? 'RETRY' : 'FAILED'), m.id);
      if (res.ok) sent++;
      else console.error('[mail] send failed', res.status, await res.text().catch(() => ''));
    } catch (err) {
      db.prepare("UPDATE email_outbox SET status = 'RETRY' WHERE id = ?").run(m.id);
      console.error('[mail] send error', err.message);
    }
  }
  return { sent };
}
