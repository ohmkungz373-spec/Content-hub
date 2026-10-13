// GET /api/cron?key=<CRON_SECRET>  (หรือ header Authorization: Bearer <CRON_SECRET>)
// เรียกทุก ~5 นาที → ส่ง push เตือนการบ้าน (ล่วงหน้า 24 ชม. / 1 ชม. / เลยกำหนด) + แจ้งบทเรียนใหม่
const { redis, initPush } = require('./_lib');

const HOUR = 36e5, DAY = 864e5;

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'ยังไม่ได้ตั้ง CRON_SECRET' });
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const key = (req.query && req.query.key) || '';
  if (auth !== secret && key !== secret) return res.status(401).json({ error: 'unauthorized' });

  try {
    const webpush = initPush();
    const now = Date.now();
    const ids = (await redis(['SMEMBERS', 'subs'])) || [];

    // ---- บทเรียนใหม่ ----
    let lessonMsg = null;
    try {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const data = await (await fetch(`https://${host}/subjects.json`, { cache: 'no-store' })).json();
      const cur = {};
      (data.subjects || []).forEach(s => s.chapters.forEach(c => { cur[s.id + '/' + c.id] = { s: s.name, t: c.title, url: `/${s.id}/${c.id}` }; }));
      const raw = await redis(['GET', 'known:chapters']);
      if (!raw) {
        await redis(['SET', 'known:chapters', JSON.stringify(Object.keys(cur))]);   // ครั้งแรก: จดไว้เฉย ๆ
      } else {
        const known = new Set(JSON.parse(raw));
        const fresh = Object.keys(cur).filter(k => !known.has(k));
        if (fresh.length) {
          const f = fresh.map(k => cur[k]);
          lessonMsg = f.length === 1
            ? { title: 'มีบทเรียนใหม่ 📘', body: `${f[0].s} · ${f[0].t}`, url: f[0].url, tag: 'new-lessons' }
            : { title: `มีบทเรียนใหม่ ${f.length} บท 📘`, body: f.slice(0, 3).map(x => `${x.s}: ${x.t}`).join('\n'), url: '/', tag: 'new-lessons' };
          await redis(['SET', 'known:chapters', JSON.stringify(Object.keys(cur))]);
        }
      }
    } catch (e) { /* อ่านรายการบทไม่ได้ → ข้ามรอบนี้ */ }

    // ---- ส่งให้แต่ละเครื่อง ----
    let sentCount = 0, removed = 0;
    await Promise.allSettled(ids.map(async id => {
      const raw = await redis(['GET', 'sub:' + id]);
      if (!raw) { await redis(['SREM', 'subs', id]); return; }
      const rec = JSON.parse(raw);
      rec.sent = rec.sent || {};
      const msgs = [];
      if (lessonMsg) msgs.push(lessonMsg);
      for (const x of rec.items || []) {
        const left = x.at - now;
        let stage = '', title = '';
        const name = x.subj || 'การบ้าน';
        if (left < 0 && left > -DAY) { stage = 'late'; title = `เลยกำหนดส่ง · ${name}`; }
        else if (left >= 0 && left <= HOUR) { stage = 'h1'; title = `อีกไม่ถึง 1 ชั่วโมง · ${name}`; }
        else if (left > HOUR && left <= DAY) { stage = 'd1'; title = `ครบกำหนดภายใน 24 ชั่วโมง · ${name}`; }
        if (!stage) continue;
        const k = x.id + ':' + stage;
        if (rec.sent[k]) continue;
        msgs.push({ title, body: x.title + (x.time ? ` (ส่ง ${x.time} น.)` : ''), url: '/', tag: 'hw-' + x.id, _k: k });
      }
      let dirty = false, dead = false;
      for (const m of msgs) {
        try {
          await webpush.sendNotification(rec.sub, JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag }), { TTL: 6 * 3600 });
          sentCount++;
          if (m._k) { rec.sent[m._k] = now; dirty = true; }
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) { dead = true; break; }
        }
      }
      if (dead) { await redis(['DEL', 'sub:' + id]); await redis(['SREM', 'subs', id]); removed++; }
      else if (dirty) await redis(['SET', 'sub:' + id, JSON.stringify(rec)]);
    }));

    res.json({ ok: true, devices: ids.length, sent: sentCount, removed });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
