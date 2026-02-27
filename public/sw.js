// sw.js — Service Worker for MONO PWA
// Handles: push notifications, notification click, offline cache stub

// ── Push Event ──
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MONO', body: event.data?.text() || '새 메시지가 도착했습니다.' };
  }

  const title = data.title || 'MONO';
  const options = {
    body: data.body || '새 메시지가 도착했습니다.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'mono-msg',
    data: data.data || {},
    vibrate: [200, 100, 200],
    renotify: true,
    requireInteraction: false,
  };

  event.waitUntil((async () => {
    // App foreground(visible)에서는 노티를 띄우지 않아 중복 알림을 줄임.
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const hasVisibleClient = windowClients.some((client) => client.visibilityState === 'visible');
    if (hasVisibleClient) return;
    await self.registration.showNotification(title, options);
  })());
});

// ── Notification Click → open or focus the app ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetPath = data.roomId
    ? `/room/${data.roomId}`
    : (data.url || "/interpret");
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if available
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open new window
      return clients.openWindow(targetUrl);
    })
  );
});

// ── Message from client (fallback local notification) ──
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, data: msgData } = event.data.payload || {};
    self.registration.showNotification(title || 'MONO', {
      body: body || '새 메시지가 도착했습니다.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: msgData || {},
      tag: 'mono-local',
    });
  }
});

// ── Install & Activate ──
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
