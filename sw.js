
const CACHE_NAME = 'content-hub-v1';

// รับ Push Notification
self.addEventListener('push', (event) => {
  let data = {
    title: 'Content Hub',
    body: 'มีเนื้อหาใหม่เข้ามาแล้ว!',
    url: '/'
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

// เมื่อผู้ใช้กดการแจ้งเตือน
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = new URL(
    event.notification.data?.url || '/',
    self.location.origin
  );

  if (url.origin !== self.location.origin) return;

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((windows) => {
      for (const windowClient of windows) {
        if (windowClient.url.startsWith(self.location.origin)) {
          windowClient.navigate(url.href);
          return windowClient.focus();
        }
      }

      return clients.openWindow(url.href);
    })
  );
});
