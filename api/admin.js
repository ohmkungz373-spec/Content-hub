// api/admin.js — หลังบ้านของ /admin-dashboard
// ล็อกอินด้วยรหัส → ได้ token (หมดอายุ 12 ชม.) → อัปโหลดไฟล์ .html เข้า content/<วิชา>/ ด้วยการ commit ขึ้น GitHub
// Vercel จะ deploy ใหม่เองหลัง commit (บทเรียนใหม่ขึ้นเว็บภายใน ~1 นาที)
//
// Environment Variables (ตั้งใน Vercel → Settings → Environment Variables):
//   GITHUB_TOKEN     (จำเป็น) fine-grained token ที่มีสิทธิ์ Contents: Read and write ของ repo นี้
//   GITHUB_REPO      (จำเป็น) เช่น  yourname/content-hub
//   GITHUB_BRANCH    (ไม่บังคับ) ค่าเริ่มต้น main
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

      // วิชาต้องมีอยู่จริง
      try { await gh(`/repos/${repo}/contents/content/${encodeURIComponent(subject)}?ref=${encodeURIComponent(branch)}`); }
      catch (e) { return res.status(404).json({ error: e.status === 404 ? `ไม่พบวิชา "${subject}" ใน content/ ของ repo` : e.message }); }

      // commit เดียวสำหรับทุกไฟล์ (Vercel deploy ครั้งเดียว)
      const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      const headSha = ref.object.sha;
      const head = await gh(`/repos/${repo}/git/commits/${headSha}`);
      const tree = [];
      for (const f of files) {
        const blob = await gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: { content: f.b64, encoding: 'base64' } });
        tree.push({ path: `content/${subject}/${f.name}`, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const nt = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree } });
      const names = files.map(f => f.name).join(', ');
      const commit = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: { message: `admin: อัปโหลดบทเรียน ${subject}: ${names}`.slice(0, 250), tree: nt.sha, parents: [headSha] } });
      await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.sha } });
      return res.json({ ok: true, count: files.length, commit: commit.sha.slice(0, 7) });
    }

    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
