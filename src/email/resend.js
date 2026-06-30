import { Resend } from 'resend';

let client = null;

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

function getClient() {
  if (!client && process.env.RESEND_API_KEY) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

export async function sendVerificationEmail(toEmail, token) {
  const c = getClient();
  if (!c) return { sent: false, reason: 'not_configured' };

  const baseUrl = process.env.APP_URL || 'https://spectrum-dating-eta.vercel.app';
  const verifyUrl = `${baseUrl}/?verify=${encodeURIComponent(token)}`;
  const fromAddr = process.env.EMAIL_FROM || 'Spectrum Dating <onboarding@resend.dev>';

  try {
    await c.emails.send({
      from: fromAddr,
      to: toEmail,
      subject: 'Verify your email — Spectrum Dating',
      html: `
        <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #24332D;">
          <h1 style="color: #3E6660; font-size: 24px;">Welcome to Spectrum Dating</h1>
          <p style="font-size: 16px; line-height: 1.6;">Thanks for joining. Please confirm your email address to secure your account.</p>
          <p style="margin: 28px 0;">
            <a href="${verifyUrl}" style="background: #3E6660; color: #fff; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-size: 16px;">Verify email</a>
          </p>
          <p style="font-size: 13px; color: #7A8C85;">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (e) {
    console.error('Resend send error:', e.message);
    return { sent: false, reason: 'send_failed' };
  }
}

export async function sendPasswordResetEmail(toEmail, token) {
  const c = getClient();
  if (!c) return { sent: false, reason: 'not_configured' };

  const baseUrl = process.env.APP_URL || 'https://spectrum-dating-eta.vercel.app';
  const resetUrl = `${baseUrl}/?reset=${encodeURIComponent(token)}`;
  const fromAddr = process.env.EMAIL_FROM || 'Spectrum Dating <onboarding@resend.dev>';

  try {
    await c.emails.send({
      from: fromAddr,
      to: toEmail,
      subject: 'Reset your password — Spectrum Dating',
      html: `
        <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #24332D;">
          <h1 style="color: #3E6660; font-size: 24px;">Reset your password</h1>
          <p style="font-size: 16px; line-height: 1.6;">We received a request to reset your Spectrum Dating password. Click below to choose a new one.</p>
          <p style="margin: 28px 0;">
            <a href="${resetUrl}" style="background: #3E6660; color: #fff; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-size: 16px;">Reset password</a>
          </p>
          <p style="font-size: 13px; color: #7A8C85;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (e) {
    console.error('Resend send error:', e.message);
    return { sent: false, reason: 'send_failed' };
  }
}
