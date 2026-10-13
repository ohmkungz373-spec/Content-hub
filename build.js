// build.js — สร้างโฟลเดอร์ public/ สำหรับ deploy บน Vercel (เว็บ static ล้วน)
// รัน:  node build.js
const fs = require('fs');
const path = require('path');
const { ROOT, CONTENT, hubData } = require('./scan');

const OUT = path.join(ROOT, 'public');
const data = hubData();
if (!data.subjects.length) {
  console.error('[build] ไม่พบวิชาใน content/ — ยกเลิก (ดีกว่า deploy เว็บเปล่า)');
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(CONTENT, path.join(OUT, 'content'), {
  recursive: true,
  filter: src => !path.basename(src).startsWith('_template')
});
fs.writeFileSync(path.join(OUT, 'subjects.json'), JSON.stringify(data));
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));

// ไฟล์ PWA (ติดตั้งเป็นแอป) — คัดลอกไปไว้ที่รากของ public/
for (const f of ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png', 'push.js']) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
  else console.warn('[build] ไม่พบไฟล์ PWA:', f);
}

const n = data.subjects.reduce((s, x) => s + x.chapters.length, 0);
console.log(`[build] เสร็จ: ${data.subjects.length} วิชา, ${n} บทเรียน → public/`);
