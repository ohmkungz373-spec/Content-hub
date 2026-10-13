// Service worker — Content Hub
// เปิดออฟไลน์ได้: เน็ตมาก่อน (ได้เนื้อหาใหม่เสมอ) ถ้าเน็ตหลุดค่อยใช้ของที่เคยเปิดไว้
const CACHE = 'content-hub-v1';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const save = (req, res) => {
  if (res && res.status === 200) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {}); }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;

  // ฟอนต์: ใช้ของในเครื่องก่อน แล้วอัปเดตเบื้องหลัง
  if (isFont) {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(r => save(req, r)).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // หน้าเว็บหลัก (เส้นทางไม่มีนามสกุลไฟล์) → ใช้ index.html
  if (req.mode === 'navigate' && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(r => { save('/index.html', r); return r; })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // ไฟล์อื่น (subjects.json, บทเรียน, รูป) → เน็ตก่อน สำรองด้วยแคช
  e.respondWith(fetch(req).then(r => save(req, r)).catch(() => caches.match(req)));
});
