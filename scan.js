// scan.js — อ่านโฟลเดอร์ content/ แล้วสร้างรายการวิชา + บทเรียน (ใช้ร่วมกันระหว่าง server.js และ build.js)
// โครงสร้าง:  content/<โฟลเดอร์วิชา>/_subject.json   ← ชื่อ/รหัส/ไอคอน/ลำดับของวิชา
//             content/<โฟลเดอร์วิชา>/<บทเรียน>.html  ← เรียงตามชื่อไฟล์ (ตั้งชื่อ 01-..., 02-... ให้เรียงถูก)
// โฟลเดอร์/ไฟล์ที่ขึ้นต้นด้วย _ จะไม่แสดงบนเว็บ
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONTENT = path.join(ROOT, 'content');

function chapterTitle(file, html) {
  const m = html.replace(/<!--[\s\S]*?-->/g, '').match(/<title>([\s\S]*?)<\/title>/i);
  let t = m ? m[1].replace(/\s+/g, ' ').trim().split('|')[0].trim() : '';
  if (!t) t = file.replace(/\.html$/i, '').replace(/^\d+[-_.\s]*/, '').replace(/[-_]+/g, ' ');
  return t;
}

function scan() {
  const subjects = [];
  if (!fs.existsSync(CONTENT)) return subjects;
  for (const d of fs.readdirSync(CONTENT, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    const dir = path.join(CONTENT, d.name);
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, '_subject.json'), 'utf8')); }
    catch (e) { console.warn(`[scan] ${d.name}: ไม่มี/อ่าน _subject.json ไม่ได้ → ใช้ชื่อโฟลเดอร์แทน`); }
    const chapters = fs.readdirSync(dir)
      .filter(f => /\.html$/i.test(f) && !f.startsWith('_'))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .map(f => ({
        id: f.replace(/\.html$/i, ''),
        file: f,
        title: chapterTitle(f, fs.readFileSync(path.join(dir, f), 'utf8'))
      }));
    subjects.push({
      id: d.name,
      code: meta.code || '',
      name: meta.name || d.name,
      icon: meta.icon || '📖',
      order: Number.isFinite(meta.order) ? meta.order : 999,
      chapters
    });
  }
  subjects.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return subjects;
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'hub.config.json'), 'utf8')); }
  catch (e) { return {}; }
}

function hubData() { return { config: readConfig(), subjects: scan() }; }

module.exports = { ROOT, CONTENT, scan, readConfig, hubData };
