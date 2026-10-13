// api/admin.js — หลังบ้านของ /admin-dashboard
// ล็อกอินด้วยรหัส → ได้ token (หมดอายุ 12 ชม.) → อัปโหลดไฟล์ .html เข้า content/<วิชา>/ ด้วยการ commit ขึ้น GitHub
// Vercel จะ deploy ใหม่เองหลัง commit (บทเรียนใหม่ขึ้นเว็บภายใน ~1 นาที)
//
// Environment Variables (ตั้งใน Vercel → Settings → Environment Variables):
//   GITHUB_TOKEN     (จำเป็น) fine-grained token ที่มีสิทธิ์ Contents: Read and write ของ repo นี้
//   GITHUB_REPO      (จำเป็น) เช่น  yourname/content-hub
//   GITHUB_BRANCH    (ไม่บังคับ) ค่าเริ่มต้น main
//   GITHUB_DIR       (ไม่บังคับ) ถ้าโปรเจกต์อยู่ในโฟลเดอร์ย่อยของ repo ใส่ชื่อโฟลเดอร์นั้น
//   ADMIN_PASSWORD   (ไม่บังคับ) ถ้าไม่ตั้ง จะใช้ zazaq123
//   ADMIN_SECRET     (ไม่บังคับ) ข้อความสุ่มสำหรับเซ็น token
const crypto = require('crypto');

const PASS = process.env.ADMIN_PASSWORD || 'zazaq123';
const SECRET = process.env.ADMIN_SECRET || ('hub-admin:' + PASS);
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeToken() { const exp = String(Date.now() + 12 * 3600e3); return exp + '.' + sign(exp); }
function okToken(t) {
  const [exp, sig] = String(t || '').split('.');
  return !!(exp && sig && safeEq(sig, sign(exp)) && Number(exp) > Date.now());
}

async function gh(path, opt = {}) {
  const r = await fetch('https://api.github.com' + path, {
    method: opt.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'content-hub-admin',
      'Content-Type': 'application/json'
    },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || ('GitHub error ' + r.status)); e.status = r.status; throw e; }
  return j;
}

const BASE = String(process.env.GITHUB_DIR || '').replace(/^\/+|\/+$/g, '');   // ถ้าโปรเจกต์อยู่ในโฟลเดอร์ย่อยของ repo
const P = p => (BASE ? BASE + '/' : '') + p;
const bad = (m, status) => { const e = new Error(m); e.status = status || 500; return e; };

async function verify(repo, branch, subject) {
  try { await gh(`/repos/${repo}`); }
  catch (e) {
    if ([401, 403, 404].includes(e.status)) throw bad(`เข้า repo "${repo}" ไม่ได้ — เช็ก GITHUB_REPO ว่าสะกดถูก (ชื่อบัญชี/ชื่อrepo) และ token ได้เลือก repo นี้ + สิทธิ์ Contents: Read and write`);
    throw e;
  }
  try { await gh(`/repos/${repo}/branches/${encodeURIComponent(branch)}`); }
  catch (e) { if (e.status === 404) throw bad(`ไม่พบ branch "${branch}" — ตั้ง GITHUB_BRANCH ให้ตรงกับ branch ที่ Vercel deploy`); throw e; }
  try { return await gh(`/repos/${repo}/contents/${P('content/' + subject).split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`); }
  catch (e) {
    if (e.status !== 404) throw e;
    let root = '';
    try { const r = await gh(`/repos/${repo}/contents/${BASE ? BASE.split('/').map(encodeURIComponent).join('/') : ''}?ref=${encodeURIComponent(branch)}`); root = (Array.isArray(r) ? r.map(x => x.name) : []).slice(0, 25).join(', '); } catch (e2) {}
    throw bad(`ไม่พบโฟลเดอร์ ${P('content/' + subject)} ใน repo (branch ${branch}). ที่เห็นที่ราก: ${root || '-'} — ถ้าโฟลเดอร์ content/ อยู่ในโฟลเดอร์ย่อย ให้ตั้ง GITHUB_DIR เป็นชื่อโฟลเดอร์นั้น`);
  }
}

async function commitTree(repo, branch, tree, message) {
  const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;
  const head = await gh(`/repos/${repo}/git/commits/${headSha}`);
  const nt = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree } });
  const commit = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: { message: message.slice(0, 250), tree: nt.sha, parents: [headSha] } });
  await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.sha } });
  return commit.sha.slice(0, 7);
}

const SUBJECT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const FILE_RE = /^[^\\/:*?"<>|\u0000-\u001f]{1,100}\.html$/i;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch (e) { return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' }); }

  try {
    if (b.action === 'login') {
      if (!safeEq(b.password || '', PASS)) { await sleep(800); return res.status(401).json({ error: 'รหัสไม่ถูกต้อง' }); }
      return res.json({ ok: true, token: makeToken() });
    }

    if (!okToken(b.token)) return res.status(401).json({ error: 'หมดเวลาการเข้าสู่ระบบ — เข้าสู่ระบบใหม่' });
    if (b.action === 'check') return res.json({ ok: true });

    if (b.action === 'upload') {
      if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO)
        return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า GITHUB_TOKEN / GITHUB_REPO ใน Vercel' });
      const repo = process.env.GITHUB_REPO, branch = process.env.GITHUB_BRANCH || 'main';

      const subject = String(b.subject || '');
      if (!SUBJECT_RE.test(subject)) return res.status(400).json({ error: 'ชื่อวิชาไม่ถูกต้อง' });
      const files = Array.isArray(b.files) ? b.files : [];
      if (!files.length || files.length > 20) return res.status(400).json({ error: 'เลือกไฟล์ 1–20 ไฟล์' });
      const seen = new Set();
      for (const f of files) {
        if (!f || !FILE_RE.test(f.name || '') || /^[._]/.test(f.name)) return res.status(400).json({ error: `ชื่อไฟล์ไม่ถูกต้อง: ${f && f.name}` });
        if (!f.b64 || typeof f.b64 !== 'string') return res.status(400).json({ error: `ไฟล์ว่าง: ${f.name}` });
        if (seen.has(f.name.toLowerCase())) return res.status(400).json({ error: `ชื่อไฟล์ซ้ำกัน: ${f.name}` });
        seen.add(f.name.toLowerCase());
      }

      await verify(repo, branch, subject);
      const tree = [];
      for (const f of files) {
        const blob = await gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: { content: f.b64, encoding: 'base64' } });
        tree.push({ path: P(`content/${subject}/${f.name}`), mode: '100644', type: 'blob', sha: blob.sha });
      }
      const commit = await commitTree(repo, branch, tree, `admin: อัปโหลดบทเรียน ${subject}: ${files.map(f => f.name).join(', ')}`);
      return res.json({ ok: true, count: files.length, commit });
    }

    if (b.action === 'delete') {
      if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO)
        return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า GITHUB_TOKEN / GITHUB_REPO ใน Vercel' });
      const repo = process.env.GITHUB_REPO, branch = process.env.GITHUB_BRANCH || 'main';
      const subject = String(b.subject || '');
      if (!SUBJECT_RE.test(subject)) return res.status(400).json({ error: 'ชื่อวิชาไม่ถูกต้อง' });
      const names = Array.isArray(b.files) ? b.files.map(String) : [];
      if (!names.length || names.length > 20) return res.status(400).json({ error: 'เลือกไฟล์ 1–20 ไฟล์' });
      for (const n of names) if (!FILE_RE.test(n) || /^[._]/.test(n)) return res.status(400).json({ error: `ชื่อไฟล์ไม่ถูกต้อง: ${n}` });
      const listing = await verify(repo, branch, subject);
      const have = new Set((Array.isArray(listing) ? listing : []).map(x => x.name));
      for (const n of names) if (!have.has(n)) return res.status(404).json({ error: `ไม่พบไฟล์ ${n} ใน repo (อาจถูกลบไปแล้ว)` });
      const tree = names.map(n => ({ path: P(`content/${subject}/${n}`), mode: '100644', type: 'blob', sha: null }));
      const commit = await commitTree(repo, branch, tree, `admin: ลบบทเรียน ${subject}: ${names.join(', ')}`);
      return res.json({ ok: true, count: names.length, commit });
    }

    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
