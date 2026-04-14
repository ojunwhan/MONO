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
    // 같은 방 경로에서 visible일 때만 억제 (다른 탭/PWA가 visible이어도 다른 방이면 알림 표시)
    const inner = data.data || {};
    const targetRoomId = inner.roomId || data.roomId || '';
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const hasVisibleClientInSameRoom = targetRoomId && windowClients.some((client) => {
      if (client.visibilityState !== 'visible') return false;
      try {
        const url = new URL(client.url);
        return url.pathname === `/room/${targetRoomId}`
          || url.pathname === `/fixed-room/${targetRoomId}`;
      } catch {
        return false;
      }
    });
    if (hasVisibleClientInSameRoom) return;
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

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    let targetPathname = '';
    try {
      targetPathname = new URL(targetUrl).pathname;
    } catch {
      targetPathname = targetPath;
    }
    const normPath = (p) => (p && p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

    // Pass 1: already on target room/path — focus only (no navigate flicker)
    const ridForMatch = data.roomId ? String(data.roomId) : '';
    for (const client of windowClients) {
      try {
        const u = new URL(client.url);
        if (u.origin !== self.location.origin) continue;
        const pn = normPath(u.pathname);
        const onSameRoom = ridForMatch && (
          pn === normPath(`/room/${ridForMatch}`) || pn === normPath(`/fixed-room/${ridForMatch}`)
        );
        if (onSameRoom || (!ridForMatch && pn === normPath(targetPathname))) {
          await client.focus();
          return;
        }
      } catch (_) { /* ignore invalid client.url */ }
    }

    // Pass 2: any same-origin window — focus then navigate
    for (const client of windowClients) {
      try {
        const u = new URL(client.url);
        if (u.origin !== self.location.origin) continue;
        await client.focus();
        if (typeof client.navigate === 'function') {
          await client.navigate(targetUrl);
        } else {
          await self.clients.openWindow(targetUrl);
        }
        return;
      } catch (_) { /* try next */ }
    }

    const fallbackUrl = (data.orgCode && data.roomId)
      ? new URL(`/hospital/join/${data.orgCode}?room=${encodeURIComponent(data.roomId)}`, self.location.origin).href
      : targetUrl;
    await self.clients.openWindow(fallbackUrl);
  })());
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
