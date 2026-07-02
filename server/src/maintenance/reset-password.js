import bcrypt from 'bcrypt';

// One-shot admin password reset, gated entirely by env vars. Set
// RESET_PASSWORD_EMAIL + RESET_PASSWORD_VALUE, deploy, verify the new login,
// then UNSET both vars. Completely inert when the vars are absent.
//
// Used because there is no self-serve password-reset flow yet and the
// production DB lives on the Railway volume (only reachable from inside the
// running container).
export async function maybeResetPassword(db) {
  const email = (process.env.RESET_PASSWORD_EMAIL || '').trim().toLowerCase();
  const value = process.env.RESET_PASSWORD_VALUE || '';
  if (!email || !value) return;

  try {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!user) {
      console.log(`[reset-password] no user found for ${email} — skipping.`);
      return;
    }
    const hash = await bcrypt.hash(value, 12);
    db.prepare(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?'
    ).run(hash, user.id);
    console.log(
      `[reset-password] password reset for ${email}. ` +
        'IMPORTANT: unset RESET_PASSWORD_EMAIL and RESET_PASSWORD_VALUE now.'
    );
  } catch (e) {
    console.error('[reset-password] failed:', e.message);
  }
}
