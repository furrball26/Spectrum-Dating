import webpush from 'web-push';

let configured = false;

export function configurePush() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    `mailto:${VAPID_CONTACT_EMAIL || 'admin@spectrum-dating.app'}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

export function isPushConfigured() {
  return configured;
}

export async function sendPush(subscription, payload) {
  if (!configured) return;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    // 410 Gone = subscription expired/unsubscribed — caller should delete it
    if (err.statusCode === 410) throw err;
    // Other errors: log but don't crash the request
    console.error('Push send error:', err.statusCode, err.body?.substring?.(0, 200));
  }
}
