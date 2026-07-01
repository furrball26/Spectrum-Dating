// digest-scheduler.js — weekly email digest job (F6).
//
// Mirrors backup/scheduler.js: a single setTimeout → setInterval loop, and it
// degrades GRACEFULLY. If no email transport is configured (no EMAIL_API_KEY /
// RESEND_API_KEY), it logs one line and NO-OPS — it never crashes boot or the
// job. Only OPTED-IN, non-suspended users are ever mailed; the digest is
// counts-only (see digest.js).

import { transportConfigured, sendEmail } from './transport.js';
import { composeDigestEmail } from './digest.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function runDigest(db) {
  if (!transportConfigured()) return; // defensive: re-check at run time
  const now = Date.now();

  // Only users who OPTED IN (weekly_digest = 1), are not suspended, and have an
  // email. Join users for the address + token_version (for the opt-out link).
  const recipients = db.prepare(
    `SELECT u.id, u.email, u.token_version
       FROM profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.weekly_digest = 1
        AND u.suspended = 0
        AND u.email IS NOT NULL AND u.email != ''`
  ).all();

  let sent = 0;
  let skipped = 0;
  for (const user of recipients) {
    try {
      const email = composeDigestEmail(db, user, now);
      if (!email) { skipped++; continue; } // nothing new → don't nag
      const result = await sendEmail({ to: user.email, subject: email.subject, text: email.text, html: email.html });
      if (result.sent) {
        // Advance the window only on a successful send.
        db.prepare('UPDATE profiles SET last_digest_sent_at = ? WHERE user_id = ?').run(now, user.id);
        sent++;
      } else {
        skipped++;
      }
    } catch (err) {
      // Never let one user's failure abort the whole run. No PII in the log.
      console.error('[digest] failed for a user:', err?.message);
      skipped++;
    }
  }
  console.log(`[digest] weekly run complete — sent ${sent}, skipped ${skipped}, candidates ${recipients.length}.`);
}

export function scheduleWeeklyDigest(db) {
  if (!transportConfigured()) {
    console.log('[digest] disabled — set EMAIL_API_KEY (or RESEND_API_KEY) + EMAIL_FROM to enable the weekly digest.');
    return;
  }

  // First run a short delay after boot (lets the app settle), then every 7 days.
  const bootDelay = 5 * 60 * 1000; // 5 min after start
  setTimeout(() => {
    runDigest(db);
    setInterval(() => runDigest(db), WEEK_MS);
  }, bootDelay);

  console.log(`[digest] enabled — first run in ${bootDelay / 60000} min, then every 7 days (opted-in users only).`);
}
