const CACHE_NAME = 'content-hub-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Content Hub', body: 'มีเนื้อหาใหม่เข้ามาแล้ว!', url: '/' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch (e) { data.body = event.data.text(); }
  }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url;
  try { url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin); }
  catch (e) { url = new URL('/', self.location.origin); }
  if (url.origin !== self.location.origin) return;

  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.location.origin)) {
        try { const c = await w.navigate(url.href); if (c) { await c.focus(); return; } } catch (e) {}
      }
    }
    await clients.openWindow(url.href);
  })());
});
