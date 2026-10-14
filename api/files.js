// api/files.js — ตัวจัดการไฟล์ของ /admin-dashboard (ดู/แก้/อัปโหลด/ลบ/ย้ายไฟล์ทุกโฟลเดอร์ใน repo ผ่าน commit ขึ้น GitHub)
// ใช้ Environment Variables ชุดเดียวกับ api/admin.js (GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, GITHUB_DIR)
const { validToken } = require('./_auth');
const BASE = String(process.env.GITHUB_DIR || '').replace(/^\/+|\/+$/g, '');
const P = p => (BASE ? BASE + '/' : '') + p;
const bad = (m, s) => { const e = new Error(m); e.status = s || 400; return e; };
const okPath = p => typeof p === 'string' && p.length > 0 && p.length <= 200 && !p.startsWith('/') && !p.endsWith('/') &&
  p.split('/').every(s => s && s !== '.' && s !== '..' && s.toLowerCase() !== '.git' && !/[\\:*?"<>|\u0000-\u001f]/.test(s));

async function gh(path, opt = {}) {
  const r = await fetch('https://api.github.com' + path, {
    method: opt.method || 'GET',
    headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'content-hub-admin', 'Content-Type': 'application/json' },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || ('GitHub error ' + r.status)); e.status = r.status; throw e; }
  return j;
}

async function snapshot(repo, branch) {
  const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const head = ref.object.sha;
  const c = await gh(`/repos/${repo}/git/commits/${head}`);
  const t = await gh(`/repos/${repo}/git/trees/${c.tree.sha}?recursive=1`);
  const pre = BASE ? BASE + '/' : '';
  const entries = (t.tree || []).filter(x => x.type === 'blob' && x.path.startsWith(pre)).map(x => ({ path: x.path.slice(pre.length), size: x.size || 0, sha: x.sha, mode: x.mode }));
  return { head, tree: c.tree.sha, entries, truncated: !!t.truncated };
}
async function commit(repo, branch, snap, tree, msg) {
  const nt = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: { base_tree: snap.tree, tree } });
  const cm = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: { message: msg.slice(0, 250), tree: nt.sha, parents: [snap.head] } });
  await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: cm.sha } });
  return cm.sha.slice(0, 7);
}
const under = (entries, p) => entries.filter(e => e.path === p || e.path.startsWith(p + '/'));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  let b; try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) { return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' }); }
  try {
    if (!validToken(b.token)) return res.status(401).json({ error: 'หมดเวลาการเข้าสู่ระบบ — เข้าสู่ระบบใหม่' });
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) throw bad('ยังไม่ได้ตั้งค่า GITHUB_TOKEN / GITHUB_REPO ใน Vercel', 500);
    const repo = process.env.GITHUB_REPO, branch = process.env.GITHUB_BRANCH || 'main';

    if (b.action === 'zip') {   // ลิงก์ดาวน์โหลด zip ทั้ง repo (GitHub ออกลิงก์ชั่วคราวให้ ไม่ผ่านเซิร์ฟเวอร์เรา จึงไม่ติดขีดจำกัดขนาด)
      const r = await fetch(`https://api.github.com/repos/${repo}/zipball/${encodeURIComponent(branch)}`, { redirect: 'manual', headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'content-hub-admin' } });
      const url = r.headers.get('location');
      if (!url) throw bad('สร้างลิงก์ดาวน์โหลดไม่สำเร็จ (' + r.status + ')', 502);
      return res.json({ ok: true, url });
    }

    if (b.action === 'list') { const s = await snapshot(repo, branch); return res.json({ ok: true, files: s.entries.slice(0, 8000), truncated: s.truncated }); }

    if (b.action === 'read') {
      if (!/^[0-9a-f]{40}$/.test(String(b.sha))) throw bad('sha ไม่ถูกต้อง');
      const j = await gh(`/repos/${repo}/git/blobs/${b.sha}`);
      if (j.size > 2.5 * 1024 * 1024) throw bad('ไฟล์ใหญ่เกินไปที่จะเปิดแก้ (เกิน 2.5 MB)');
      return res.json({ ok: true, b64: String(j.content || '').replace(/\n/g, ''), size: j.size });
    }

    if (b.action === 'write') {
      const files = Array.isArray(b.files) ? b.files : [];
      if (!files.length || files.length > 60) throw bad('เลือกไฟล์ 1–60 ไฟล์');
      for (const f of files) if (!f || !okPath(f.path) || typeof f.b64 !== 'string') throw bad('ชื่อ/ที่อยู่ไฟล์ไม่ถูกต้อง: ' + (f && f.path));
      const snap = await snapshot(repo, branch), tree = [];
      for (let i = 0; i < files.length; i += 6) {
        const part = await Promise.all(files.slice(i, i + 6).map(f => gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: { content: f.b64, encoding: 'base64' } })));
        part.forEach((bl, k) => { const old = snap.entries.find(e => e.path === files[i + k].path); tree.push({ path: P(files[i + k].path), mode: old ? old.mode : '100644', type: 'blob', sha: bl.sha }); });
      }
      const c = await commit(repo, branch, snap, tree, `admin: บันทึกไฟล์ ${files.map(f => f.path).slice(0, 5).join(', ')}${files.length > 5 ? ` +${files.length - 5}` : ''}`);
      return res.json({ ok: true, count: files.length, commit: c });
    }

    if (b.action === 'delete') {
      const paths = Array.isArray(b.paths) ? b.paths : [];
      if (!paths.length || paths.some(p => !okPath(p))) throw bad('ที่อยู่ไฟล์ไม่ถูกต้อง');
      const snap = await snapshot(repo, branch), hit = new Map();
      paths.forEach(p => under(snap.entries, p).forEach(e => hit.set(e.path, e)));
      if (!hit.size) throw bad('ไม่พบไฟล์ (อาจถูกลบไปแล้ว)', 404);
      if (hit.size > 500) throw bad('ลบครั้งเดียวได้ไม่เกิน 500 ไฟล์');
      const c = await commit(repo, branch, snap, [...hit.keys()].map(p => ({ path: P(p), mode: '100644', type: 'blob', sha: null })), `admin: ลบ ${paths.slice(0, 5).join(', ')}${paths.length > 5 ? ` +${paths.length - 5}` : ''}`);
      return res.json({ ok: true, count: hit.size, commit: c });
    }

    if (b.action === 'move') {   // เปลี่ยนชื่อ/ย้าย ไฟล์หรือทั้งโฟลเดอร์
      const from = String(b.from || ''), to = String(b.to || '').trim();
      if (!okPath(from) || !okPath(to)) throw bad('ที่อยู่ไม่ถูกต้อง');
      if (from === to) throw bad('ชื่อใหม่ซ้ำกับชื่อเดิม');
      if (to.startsWith(from + '/')) throw bad('ย้ายโฟลเดอร์เข้าไปในตัวเองไม่ได้');
      const snap = await snapshot(repo, branch), src = under(snap.entries, from);
      if (!src.length) throw bad('ไม่พบไฟล์ (อาจถูกลบหรือเปลี่ยนชื่อไปแล้ว)', 404);
      if (src.length > 500) throw bad('ย้ายครั้งเดียวได้ไม่เกิน 500 ไฟล์');
      if (under(snap.entries, to).length) throw bad(`มี “${to}” อยู่แล้ว`, 409);
      const tree = [];
      src.forEach(e => { tree.push({ path: P(to + e.path.slice(from.length)), mode: e.mode, type: 'blob', sha: e.sha }); tree.push({ path: P(e.path), mode: e.mode, type: 'blob', sha: null }); });
      const c = await commit(repo, branch, snap, tree, `admin: ย้าย ${from} -> ${to}`);
      return res.json({ ok: true, commit: c });
    }
    if (b.action === 'commit-time') {
      const p = String(b.path || '');
      if (!okPath(p)) throw bad('path ไม่ถูกต้อง');
      const fp = P(p);
      const commits = await gh(`/repos/${repo}/commits?path=${encodeURIComponent(fp)}&per_page=1&sha=${encodeURIComponent(branch)}`);
      if (!commits.length) return res.json({ ok: true, date: null });
      return res.json({ ok: true, date: commits[0].commit.committer.date, message: commits[0].commit.message.split('\n')[0] });
    }

    throw bad('unknown action');
  } catch (e) { res.status(e.status && e.status < 600 && e.status >= 400 ? e.status : 500).json({ error: String(e.message || e) }); }
};
