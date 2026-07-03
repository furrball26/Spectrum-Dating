// Spectrum Dating — Service Worker
// Handles push notifications, notification clicks, and a calm offline fallback.

// Bump this when offline.html changes so the activate handler evicts stale
// caches. Only offline.html is ever precached — NEVER hashed build assets
// (/assets/*): a redeploy must always serve the newest bundle, so JS/CSS pass
// straight through to the network (prior "stale-chunk" deploy scars).
const OFFLINE_CACHE = 'spectrum-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) => cache.addAll([OFFLINE_URL]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Navigation-only, network-first. Everything that isn't a top-level navigation
// (JS/CSS/images/API) passes straight through to the network untouched — no
// cache-first on build assets, so the newest bundle always wins. Only when a
// navigation fails (offline) do we serve the calm offline page.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL))
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Spectrum Dating', body: event.data.text() };
  }

  const { title = 'Spectrum Dating', body = '', icon = '/icon-192.png', badge = '/icon-192.png', tag, data } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      data: data || {},
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus an existing window if one is open, THEN navigate it to the target
      // (focus alone leaves the user wherever they were — the click did nothing).
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return Promise.resolve(client.focus()).then(() =>
            'navigate' in client ? client.navigate(urlToOpen) : undefined
          );
        }
      }
      // Otherwise open a new window.
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
