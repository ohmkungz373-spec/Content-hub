
/**
 * build.js
 * สร้างโฟลเดอร์ public/ สำหรับ Deploy บน Vercel
 * ใช้ร่วมกับ scan.js
 */

const fs = require('fs');
const path = require('path');

const { ROOT, CONTENT, hubData } = require('./scan');

const OUT = path.join(ROOT, 'public');
const ADMIN_SRC = path.join(ROOT, 'admin.html');
const ADMIN_DEST = path.join(OUT, 'admin.html');

// 1. อ่านข้อมูลวิชา
console.log('[build] เริ่มสร้างเว็บไซต์...');

const data = hubData();

if (!data.subjects.length) {
  console.error('[build] ERROR: ไม่พบวิชาใน content/');
  process.exit(1);
}

// 2. ตรวจสอบไฟล์ Admin ก่อนเริ่ม Build
if (!fs.existsSync(ADMIN_SRC)) {
  console.error('[build] ERROR: ไม่พบ admin.html ที่ราก Repository');
  console.error('[build] กรุณาตรวจสอบว่า admin.html อยู่ใน Branch ที่ Deploy');
  process.exit(1);
}

// 3. สร้างโฟลเดอร์ public ใหม่
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 4. คัดลอกเนื้อหาวิชา
if (!fs.existsSync(CONTENT)) {
  console.error('[build] ERROR: ไม่พบโฟลเดอร์ content/');
  process.exit(1);
}

fs.cpSync(CONTENT, path.join(OUT, 'content'), {
  recursive: true,
  filter: (src) => !path.basename(src).startsWith('_template')
});

// 5. สร้างรายการวิชา
fs.writeFileSync(
  path.join(OUT, 'subjects.json'),
  JSON.stringify(data)
);

// 6. คัดลอกหน้าแรก
const INDEX_SRC = path.join(ROOT, 'index.html');
const INDEX_DEST = path.join(OUT, 'index.html');

if (!fs.existsSync(INDEX_SRC)) {
  console.error('[build] ERROR: ไม่พบ index.html');
  process.exit(1);
}

fs.copyFileSync(INDEX_SRC, INDEX_DEST);

// 7. คัดลอกหน้า Admin และตรวจสอบผล
fs.copyFileSync(ADMIN_SRC, ADMIN_DEST);

if (!fs.existsSync(ADMIN_DEST)) {
  console.error('[build] ERROR: คัดลอก admin.html ไม่สำเร็จ');
  process.exit(1);
}

console.log('[build] คัดลอก admin.html สำเร็จ → public/admin.html');

// 8. คัดลอกไฟล์ PWA ที่มีอยู่
const PWA_FILES = [
  'manifest.webmanifest',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'favicon-32.png'
];

for (const file of PWA_FILES) {
  const src = path.join(ROOT, file);
  const dest = path.join(OUT, file);

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[build] คัดลอก ${file} สำเร็จ`);
  } else {
    console.warn(`[build] ไม่พบไฟล์ PWA: ${file}`);
  }
}

// 9. สรุปผล Build
const chapterCount = data.subjects.reduce(
  (total, subject) => total + subject.chapters.length,
  0
);

console.log(
  `[build] เสร็จ: ${data.subjects.length} วิชา, ` +
  `${chapterCount} บทเรียน → public/`
);

console.log('[build] ตรวจสอบเส้นทาง Admin: /admin-dashboard');
console.log('[build] Build สำเร็จ');
