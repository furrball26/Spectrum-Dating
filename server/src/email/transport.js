// transport.js — thin, provider-agnostic email transport abstraction.
//
// Exposes a single `sendEmail({ to, subject, text, html })`. It degrades
// GRACEFULLY: if no provider is configured via ENV, it logs a single line and
// returns { sent: false, reason: 'not_configured' } — it NEVER throws and NEVER
// crashes the app on boot or during a job. (A prior R2 import crash caused a
// full outage; we do not repeat that. The provider SDK is imported LAZILY, only
// inside the configured branch, so a missing/broken dep can't take down boot.)
//
// Provider config (all read from ENV; nothing hardcoded):
//   EMAIL_PROVIDER   — which provider to use. Currently supported: 'resend'.
//                      Defaults to 'resend' when unset (the repo's existing
//                      integration). Any other value → treated as unconfigured.
//   EMAIL_API_KEY    — the provider API key. For back-compat with the existing
//                      email/resend.js module, RESEND_API_KEY is also accepted.
//   EMAIL_FROM       — the From address, e.g. 'Spectrum Dating <hi@example.com>'.
//                      Defaults to the Resend onboarding sandbox sender.
//
// To go live: pick a provider, set EMAIL_API_KEY (or RESEND_API_KEY) + EMAIL_FROM
// on the host, and deploy. No code change required for Resend.

const DEFAULT_FROM = 'Spectrum Dating <onboarding@resend.dev>';

function provider() {
  return (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
}

function apiKey() {
  // Accept either the generic name or the repo's existing RESEND_API_KEY.
  return process.env.EMAIL_API_KEY || process.env.RESEND_API_KEY || '';
}

// True only when we have a supported provider AND an API key. This is the guard
// every caller (and the scheduler) checks before attempting to send.
export function transportConfigured() {
  return provider() === 'resend' && !!apiKey();
}

let _client = null;

// Lazily construct the provider client. The SDK import lives INSIDE the
// configured branch so an absent/broken provider dependency can never be
// evaluated at module load / boot time.
async function getClient() {
  if (_client) return _client;
  if (provider() !== 'resend' || !apiKey()) return null;
  const { Resend } = await import('resend'); // lazy — only when configured
  _client = new Resend(apiKey());
  return _client;
}

/**
 * Send one email. Never throws.
 * @param {{ to: string, subject: string, text?: string, html?: string }} msg
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendEmail({ to, subject, text, html }) {
  if (!transportConfigured()) {
    console.log('[email] transport not configured, skipping — set EMAIL_API_KEY (or RESEND_API_KEY) + EMAIL_FROM to enable.');
    return { sent: false, reason: 'not_configured' };
  }
  if (!to || !subject || (!text && !html)) {
    return { sent: false, reason: 'invalid_message' };
  }

  const from = process.env.EMAIL_FROM || DEFAULT_FROM;

  try {
    const client = await getClient();
    if (!client) return { sent: false, reason: 'not_configured' };
    await client.emails.send({ from, to, subject, text, html });
    return { sent: true };
  } catch (e) {
    // Log the failure WITHOUT the recipient address (no PII in logs) and swallow
    // — a send failure must never crash the caller or the scheduled job.
    console.error('[email] send failed:', e?.message);
    return { sent: false, reason: 'send_failed' };
  }
}
