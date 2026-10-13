// sw.js — service worker ของ Content Hub (ใช้แสดงการแจ้งเตือน; ไม่แคชไฟล์ จึงไม่กระทบการอัปเดตเว็บ)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// แตะการแจ้งเตือน → เปิด/โฟกัสแอป แล้วไปหน้าที่เกี่ยวข้อง
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(url); } catch (err) {} }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

// เผื่อใช้ Web Push ในอนาคต (ถ้ามีเซิร์ฟเวอร์ส่ง push มา)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Content Hub', {
    body: d.body || '', icon: '/icon-192.png', badge: '/favicon-32.png', tag: d.tag || undefined, data: { url: d.url || '/' }
  }));
});
