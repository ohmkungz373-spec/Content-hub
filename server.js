// server.js — เซิร์ฟเวอร์สำหรับรันในเครื่อง:  node server.js  → http://localhost:3000
// อ่านโฟลเดอร์ content/ ใหม่ทุกครั้งที่เปิดหน้า จึงเพิ่มบทเรียนแล้วรีเฟรชได้เลย ไม่ต้องรีสตาร์ท
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT, CONTENT, hubData } = require('./scan');

const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
};

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(res, 400, 'text/plain', 'Bad request'); }

  if (p === '/subjects.json') return send(res, 200, MIME['.json'], JSON.stringify(hubData()));

  if (p.startsWith('/content/')) {
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(CONTENT + path.sep)) return send(res, 403, 'text/plain', 'Forbidden');
    return fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'text/plain', 'Not found');
      send(res, 200, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', buf);
    });
  }

  // หน้า admin (ใช้อัปโหลดได้เฉพาะตอน deploy บน Vercel)
  if (p === '/admin-dashboard' || p === '/admin-dashboard/') {
    return fs.readFile(path.join(ROOT, 'admin.html'), (err, buf) =>
      err ? send(res, 500, 'text/plain', 'admin.html missing') : send(res, 200, MIME['.html'], buf));
  }

  // ทุกหน้าที่ไม่มีนามสกุล (/, /physics, /physics/01-intro) → index.html
  if (!path.extname(p) || p === '/index.html') {
    return fs.readFile(path.join(ROOT, 'index.html'), (err, buf) =>
      err ? send(res, 500, 'text/plain', 'index.html missing') : send(res, 200, MIME['.html'], buf));
  }
  send(res, 404, 'text/plain', 'Not found');
}).listen(PORT, () => console.log(`Content Hub → http://localhost:${PORT}`));
