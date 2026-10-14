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
  // เร็วขึ้น: ดึง "head → commit" กับ "รายการไฟล์ทั้งต้นไม้" พร้อมกัน (เดิมทำทีละขั้น 3 รอบ)
  const headP = (async () => { const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`); const c = await gh(`/repos/${repo}/git/commits/${ref.object.sha}`); return { head: ref.object.sha, tree: c.tree.sha }; })();
  headP.catch(() => {});
  let t;
  try { t = await gh(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`); }
  catch (e) { const h = await headP; t = await gh(`/repos/${repo}/git/trees/${h.tree}?recursive=1`); }
  const h = await headP;
  const pre = BASE ? BASE + '/' : '';
  const entries = (t.tree || []).filter(x => x.type === 'blob' && x.path.startsWith(pre)).map(x => ({ path: x.path.slice(pre.length), size: x.size || 0, sha: x.sha, mode: x.mode }));
  return { head: h.head, tree: h.tree, entries, truncated: !!t.truncated };
}
async function headInfo(repo, branch) { const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`); const c = await gh(`/repos/${repo}/git/commits/${ref.object.sha}`); return { head: ref.object.sha, tree: c.tree.sha }; }
async function blobsOf(repo, list) {   // สร้าง blob ขนานกันครั้งละ 10
  const out = [];
  for (let i = 0; i < list.length; i += 10) out.push(...await Promise.all(list.slice(i, i + 10).map(c => gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: { content: c, encoding: 'base64' } }).then(r => r.sha))));
  return out;
}
const b64len = s => Math.max(0, Math.floor(s.length * 3 / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0));
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
      const headP = headInfo(repo, branch); headP.catch(() => {});
      const bl = await blobsOf(repo, files.map(f => f.b64));
      const h = await headP;
      const tree = files.map((f, k) => ({ path: P(f.path), mode: '100644', type: 'blob', sha: bl[k] }));
      const c = await commit(repo, branch, h, tree, `admin: บันทึกไฟล์ ${files.map(f => f.path).slice(0, 5).join(', ')}${files.length > 5 ? ` +${files.length - 5}` : ''}`);
      return res.json({ ok: true, count: files.length, commit: c, entries: files.map((f, k) => ({ path: f.path, size: b64len(f.b64), sha: bl[k], mode: '100644' })) });
    }

    // อัปโหลดไฟล์ใหญ่/หลายไฟล์แบบเร็ว: 1) ส่งเนื้อไฟล์ขึ้นเป็น blob (เรียกขนานกันได้หลายคำขอ) 2) commit ครั้งเดียวรวมทุกไฟล์
    if (b.action === 'putblobs') {
      const arr = Array.isArray(b.items) ? b.items : [];
      if (!arr.length || arr.length > 60 || arr.some(x => !x || typeof x.b64 !== 'string')) throw bad('ข้อมูลไม่ถูกต้อง');
      return res.json({ ok: true, shas: await blobsOf(repo, arr.map(x => x.b64)) });
    }
    if (b.action === 'commitfiles') {
      const arr = Array.isArray(b.items) ? b.items : [];
      if (!arr.length || arr.length > 300) throw bad('เลือกไฟล์ 1–300 ไฟล์');
      for (const x of arr) if (!x || !okPath(x.path) || !/^[0-9a-f]{40}$/.test(String(x.sha))) throw bad('ข้อมูลไฟล์ไม่ถูกต้อง: ' + (x && x.path));
      const h = await headInfo(repo, branch);
      const c = await commit(repo, branch, h, arr.map(x => ({ path: P(x.path), mode: '100644', type: 'blob', sha: x.sha })), `admin: อัปโหลด ${arr.map(x => x.path).slice(0, 5).join(', ')}${arr.length > 5 ? ` +${arr.length - 5}` : ''}`);
      return res.json({ ok: true, count: arr.length, commit: c, entries: arr.map(x => ({ path: x.path, size: +x.size || 0, sha: x.sha, mode: '100644' })) });
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
      for (let i = 0; i < items.length; i += 14) {
        await Promise.all(items.slice(i, i + 14).map(async it => {
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
      const makeBackup = async (name, at) => {
        const sha = at || await headSha();
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
        const cur = await headSha();                       // ล็อกจุดปัจจุบันไว้ — ชุด "ก่อนกู้คืน" และตัวที่จะถูกทับคือ commit เดียวกันเป๊ะ
        const curC = await gh(`/repos/${repo}/git/commits/${cur}`);
        const safety = await makeBackup('ก่อนกู้คืน: ' + label.slice(0, 60), cur);   // ถ้าขั้นนี้พัง จะไม่แตะไฟล์ใดๆ
        // สร้าง commit ที่ tree = tree ของชุดสำรองทุกประการ → ไฟล์ที่อยู่ในชุดถูกคืนมา ไฟล์ที่ไม่อยู่ในชุดถูกลบ
        const cm = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: { message: ('admin: กู้คืนข้อมูลสำรอง ' + label).slice(0, 250), tree: bc.tree.sha, parents: [cur] } });
        try { await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: cm.sha } }); }   // ไม่ force: ถ้ามีคน commit แทรกมา จะล้มเหลวโดยไม่เขียนทับงานของเขา
        catch (e) { throw bad('กู้คืนไม่สำเร็จ เพราะมีการแก้ไขไฟล์แทรกเข้ามาระหว่างทำงาน — ยังไม่มีอะไรถูกเปลี่ยน กรุณากดโหลดอีกครั้ง', 409); }
        // ตรวจผลลัพธ์จริงจาก GitHub: tree ของ branch ต้องเท่ากับ tree ของชุดสำรอง
        const after = await gh(`/repos/${repo}/git/commits/${await headSha()}`);
        const verified = after.tree.sha === bc.tree.sha;
        let stat = null;
        try {
          const [x, y] = await Promise.all([gh(`/repos/${repo}/git/trees/${curC.tree.sha}?recursive=1`), gh(`/repos/${repo}/git/trees/${bc.tree.sha}?recursive=1`)]);
          const A = new Map((x.tree || []).filter(e => e.type === 'blob').map(e => [e.path, e.sha])), B = new Map((y.tree || []).filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
          let removed = 0, restored = 0, same = 0;
          for (const [k, v] of A) if (!B.has(k)) removed++;
          for (const [k, v] of B) { if (!A.has(k) || A.get(k) !== v) restored++; else same++; }
          stat = { removed, restored, same, total: B.size };
        } catch (e) {}
        return res.json({ ok: true, verified, commit: cm.sha.slice(0, 7), safety, stat });
      }
    }

    throw bad('unknown action');
  } catch (e) { res.status(e.status && e.status < 600 && e.status >= 400 ? e.status : 500).json({ error: String(e.message || e) }); }
};
