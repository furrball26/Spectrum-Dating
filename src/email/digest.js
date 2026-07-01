// digest.js — weekly digest COMPOSITION logic (F6).
//
// Privacy law (calm-by-design): the digest is COUNTS ONLY. No names, no faces,
// no message previews — just "you have N new matches and M unread messages".
// This mirrors the product's calm-by-design stance: it reduces anxiety and
// gives gentle clarity without pulling the user into urgency or surveillance.

import { signPurposeToken } from '../middleware/auth.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const APP_URL = () => process.env.APP_URL || 'https://spectrum-dating-eta.vercel.app';

/**
 * Compute the weekly digest COUNTS for one user.
 *
 * Window: from the user's last_digest_sent_at, or a rolling 7-day window if we
 * have never sent them one (last_digest_sent_at = 0). Counts only.
 *
 * - newMatches:   matches created since the window start where the user is a party.
 * - unreadMessages: messages from the OTHER party, sent after this user's per-
 *   conversation read cursor (same definition messaging.js uses for hasUnread),
 *   restricted to messages within the window and not deleted, in non-archived
 *   conversations.
 *
 * @returns {{ since: number, newMatches: number, unreadMessages: number }}
 */
export function computeDigestCounts(db, userId, now = Date.now()) {
  const row = db.prepare('SELECT last_digest_sent_at FROM profiles WHERE user_id = ?').get(userId);
  const lastSent = row?.last_digest_sent_at || 0;
  const since = lastSent > 0 ? lastSent : now - WEEK_MS;

  const newMatches = db.prepare(
    `SELECT COUNT(*) AS cnt FROM matches
      WHERE (user_a_id = ? OR user_b_id = ?) AND matched_at > ?`
  ).get(userId, userId, since).cnt;

  // Unread = incoming messages (sender is the other party) newer than THIS
  // user's read cursor for that conversation, within the window, not deleted,
  // in a conversation the user hasn't archived. Matches messaging.js semantics.
  const unreadMessages = db.prepare(
    `SELECT COUNT(*) AS cnt
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.deleted = 0
        AND m.sender_id != ?
        AND m.sent_at > ?
        AND (
          (c.user_a_id = ? AND c.archived_by_a = 0 AND m.sent_at > c.last_read_at_a)
          OR
          (c.user_b_id = ? AND c.archived_by_b = 0 AND m.sent_at > c.last_read_at_b)
        )`
  ).get(userId, since, userId, userId).cnt;

  return { since, newMatches, unreadMessages };
}

/**
 * Build a signed, single-purpose opt-out link. Reuses the existing purpose-token
 * pattern (carries the user's token_version so it can't be replayed after other
 * security events). The link is a stable, per-user unsubscribe mechanism.
 */
export function buildOptOutUrl(userId, tokenVersion = 0) {
  const token = signPurposeToken(userId, 'digest_optout', tokenVersion, '30d');
  return `${APP_URL()}/?digestOptOut=${encodeURIComponent(token)}`;
}

/**
 * Compose the full digest email (subject + text + html) for a user, or null if
 * there is nothing worth mailing (no new matches AND no unread messages — we do
 * NOT send an empty "you have 0 things" nag; that would be noise, not calm).
 *
 * COUNTS ONLY in the payload — never any name, photo, or message text.
 */
export function composeDigestEmail(db, user, now = Date.now()) {
  const { newMatches, unreadMessages } = computeDigestCounts(db, user.id, now);
  if (newMatches === 0 && unreadMessages === 0) return null;

  const optOutUrl = buildOptOutUrl(user.id, user.token_version ?? 0);
  const appUrl = APP_URL();

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const lines = [];
  if (newMatches > 0) lines.push(plural(newMatches, 'new match', 'new matches'));
  if (unreadMessages > 0) lines.push(plural(unreadMessages, 'unread message', 'unread messages'));
  const summary = lines.join(' and ');

  const subject = 'Your weekly Spectrum Dating summary';

  const text = [
    'A gentle weekly summary from Spectrum Dating.',
    '',
    `This week you have ${summary}.`,
    '',
    `When you feel ready, you can take a look here: ${appUrl}`,
    '',
    'No rush — these will still be here whenever you return.',
    '',
    `To stop receiving these weekly emails, open this link: ${optOutUrl}`,
    'You can also manage this anytime in Settings.',
  ].join('\n');

  const matchRow = newMatches > 0
    ? `<li style="margin: 6px 0;">${plural(newMatches, 'new match', 'new matches')}</li>`
    : '';
  const msgRow = unreadMessages > 0
    ? `<li style="margin: 6px 0;">${plural(unreadMessages, 'unread message', 'unread messages')}</li>`
    : '';

  const html = `
    <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #24332D;">
      <h1 style="color: #3E6660; font-size: 22px;">Your weekly summary</h1>
      <p style="font-size: 16px; line-height: 1.6;">A gentle check-in from Spectrum Dating. This week you have:</p>
      <ul style="font-size: 16px; line-height: 1.6; padding-left: 20px;">
        ${matchRow}
        ${msgRow}
      </ul>
      <p style="margin: 28px 0;">
        <a href="${appUrl}" style="background: #3E6660; color: #fff; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-size: 16px;">Take a look</a>
      </p>
      <p style="font-size: 14px; color: #7A8C85; line-height: 1.6;">No rush — these will still be here whenever you return.</p>
      <p style="font-size: 13px; color: #7A8C85; line-height: 1.6;">
        You're getting this because you opted in to weekly summaries.
        <a href="${optOutUrl}" style="color: #7A8C85;">Unsubscribe</a>, or manage it anytime in Settings.
      </p>
    </div>
  `;

  return { subject, text, html };
}
