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
const TIME_CACHE = new Map();
const BK_PREFIX = 'hub-backup-';
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
    // ---------- เวลาที่ไฟล์ถูกอัปโหลด/แก้ไขล่าสุด (วันที่ commit ล่าสุดของแต่ละไฟล์) ----------
    if (b.action === 'times') {
            const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40)
        .filter(x => x && typeof x.path === 'string' && x.path.length < 200 && !x.path.includes('..'));
      const out = {};
      for (let i = 0; i < items.length; i += 8) {
        await Promise.all(items.slice(i, i + 8).map(async it => {
          const key = branch + '|' + it.path + '|' + (it.dir ? 'dir' : it.sha);   // โฟลเดอร์ = commit ล่าสุดที่แตะไฟล์ใดก็ตามข้างใน (แคช 60 วินาที)
          const hit = TIME_CACHE.get(key);
          if (hit && (!it.dir || hit.exp > Date.now())) { out[it.path] = hit.v; return; }
          try {
            const r = await gh(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(P(it.path))}&per_page=1`);
            const d = r && r[0] && r[0].commit && (r[0].commit.committer || r[0].commit.author);
            if (d && d.date) { out[it.path] = d.date; if (TIME_CACHE.size > 3000) TIME_CACHE.clear(); TIME_CACHE.set(key, { v: d.date, exp: Date.now() + 60000 }); }
          } catch (e) {}
        }));
      }
      return res.json({ ok: true, times: out });
    }

    // ---------- สำรอง / กู้คืนทั้งระบบ (เก็บเป็น git tag ชี้ไปที่ commit ปัจจุบัน = ทุกโฟลเดอร์ ทุกไฟล์) ----------
    if (/^backup(List|Save|Restore|Delete)$/.test(b.action || '')) {
            const headSha = async () => (await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
      const makeBackup = async name => {
        const sha = await headSha();
        const id = BK_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const tg = await gh(`/repos/${repo}/git/tags`, { method: 'POST', body: { tag: id, message: name, object: sha, type: 'commit', tagger: { name: 'hub-admin', email: 'admin@hub.local', date: new Date().toISOString() } } });
        await gh(`/repos/${repo}/git/refs`, { method: 'POST', body: { ref: 'refs/tags/' + id, sha: tg.sha } });
        return { id, name, date: new Date().toISOString(), commit: sha.slice(0, 7) };
      };
      const okId = id => /^hub-backup-[0-9a-z]{6,20}$/.test(String(id || ''));

      if (b.action === 'backupList') {
        let refs = [];
        try { refs = await gh(`/repos/${repo}/git/matching-refs/tags/${BK_PREFIX}`); } catch (e) { if (e.status !== 404) throw e; }
        refs = (Array.isArray(refs) ? refs : []).slice(-60);
        const items = [];
        for (let i = 0; i < refs.length; i += 8) {
          const part = await Promise.all(refs.slice(i, i + 8).map(async r => {
            try {
              const id = r.ref.replace('refs/tags/', '');
              if (r.object.type === 'tag') { const t = await gh(`/repos/${repo}/git/tags/${r.object.sha}`); return { id, name: String(t.message || '').trim() || id, date: (t.tagger && t.tagger.date) || '', commit: t.object.sha.slice(0, 7) }; }
              return { id, name: id, date: '', commit: r.object.sha.slice(0, 7) };
            } catch (e) { return null; }
          }));
          part.forEach(x => x && items.push(x));
        }
        items.sort((x, y) => String(y.date).localeCompare(String(x.date)));
        return res.json({ ok: true, items });
      }

      if (b.action === 'backupSave') {
        const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!name) return res.status(400).json({ error: 'กรุณาใส่ชื่อที่จะบันทึก' });
        return res.json({ ok: true, item: await makeBackup(name) });
      }

      if (b.action === 'backupDelete') {
        if (!okId(b.id)) return res.status(400).json({ error: 'รหัสสำรองไม่ถูกต้อง' });
        await gh(`/repos/${repo}/git/refs/tags/${b.id}`, { method: 'DELETE' });
        return res.json({ ok: true });
      }

      if (b.action === 'backupRestore') {
        if (!okId(b.id)) return res.status(400).json({ error: 'รหัสสำรองไม่ถูกต้อง' });
        let ref;
        try { ref = await gh(`/repos/${repo}/git/ref/tags/${b.id}`); } catch (e) { if (e.status === 404) return res.status(404).json({ error: 'ไม่พบข้อมูลสำรองนี้ (อาจถูกลบไปแล้ว)' }); throw e; }
        let target = ref.object.sha, label = b.id;
        if (ref.object.type === 'tag') { const t = await gh(`/repos/${repo}/git/tags/${ref.object.sha}`); target = t.object.sha; label = String(t.message || b.id).trim(); }
        const bc = await gh(`/repos/${repo}/git/commits/${target}`);
        let safety = null;
        if (b.safety !== false) safety = await makeBackup('ก่อนกู้คืน: ' + label.slice(0, 60));   // กันพลาด: เก็บสภาพปัจจุบันไว้ก่อนเสมอ
        const cur = await headSha();
        const cm = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: { message: ('admin: กู้คืนข้อมูลสำรอง ' + label).slice(0, 250), tree: bc.tree.sha, parents: [cur] } });
        await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: cm.sha } });
        return res.json({ ok: true, commit: cm.sha.slice(0, 7), safety });
      }
    }

    throw bad('unknown action');
  } catch (e) { res.status(e.status && e.status < 600 && e.status >= 400 ? e.status : 500).json({ error: String(e.message || e) }); }
};
