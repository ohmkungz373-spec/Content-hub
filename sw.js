const CACHE_NAME = 'content-hub-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Content Hub', body: 'มีเนื้อหาใหม่เข้ามาแล้ว!', url: '/' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch (e) { data.body = event.data.text(); }
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' }
    });
    // ส่งให้หน้าเว็บที่เปิดอยู่บันทึกลงประวัติการแจ้งเตือนทันที
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(w => w.postMessage({ type: 'push', title: data.title, body: data.body, url: data.url || '/', ts: Date.now() }));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url;
  try { url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin); }
  catch (e) { url = new URL('/', self.location.origin); }
  if (url.origin !== self.location.origin) return;

  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = wins.filter(w => w.url.startsWith(self.location.origin));
    if (mine.length) {
      // มีหน้าเว็บ/แอปเปิดอยู่แล้ว → โฟกัส แล้วบอกให้ไปหน้านั้น (ไม่รีโหลด ใช้ได้ทั้งแอปที่ติดตั้งและเบราว์เซอร์)
      const w = mine.find(x => x.focused) || mine[0];
      try { await w.focus(); } catch (e) {}
      w.postMessage({ type: 'open', url: url.pathname + url.search });
      return;
    }
    await clients.openWindow(url.href);   // ยังไม่เปิด → เปิดใหม่ที่ลิงก์นั้น (หน้าเว็บอ่าน ?s= / ?hw= แล้วพาไปเอง)
  })());
});
