// Vercel Cron: ทุกวัน 07:00 (เวลาไทย) ส่งแจ้งเตือนการบ้านที่ใกล้ถึง/เลยกำหนด
// ต้องตั้ง Environment Variable: CRON_SECRET (ข้อความสุ่มยาว ๆ) — Vercel จะส่งมาให้เองตอนเรียก cron
const crypto = require('crypto');
const P = require('./_push');
const day = off => new Date(Date.now() + 7 * 3600e3 + off * 864e5).toISOString().slice(0, 10);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'ยังไม่ได้ตั้ง CRON_SECRET' });
  const got = Buffer.from(String(req.headers.authorization || '')), want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const cfg = P.setup();
    if (cfg.error) return res.status(500).json({ error: cfg.error });

    let rows;
    try { rows = await P.fetchAll(cfg, 'push_homework', 'endpoint,subscription,items', 'endpoint.asc'); }
    catch (e) { console.error('cron query failed:', e.message); return res.status(502).json({ error: 'อ่านข้อมูลไม่สำเร็จ' }); }

    const today = day(0), tmr = day(1), old = day(-2);
    const jobs = [];
    for (const row of rows) {
      const its = (Array.isArray(row.items) ? row.items : []).filter(x => x && x.due >= old && x.due <= tmr);
      if (!its.length) continue;
      const t = its.filter(x => x.due === today), n = its.filter(x => x.due === tmr), o = its.filter(x => x.due < today);
      const f = x => (x.subj ? x.subj + ': ' : '') + x.title + (x.time ? ` (${x.time} น.)` : '');
      const lines = [];
      if (o.length) lines.push('เลยกำหนด: ' + o.map(f).join(', '));
      if (t.length) lines.push('ส่งวันนี้: ' + t.map(f).join(', '));
      if (n.length) lines.push('ส่งพรุ่งนี้: ' + n.map(f).join(', '));
      jobs.push({ endpoint: row.endpoint, subscription: row.subscription, payload: JSON.stringify({ title: `การบ้านที่ต้องส่ง ${its.length} งาน`, body: lines.join('\n').slice(0, 300), url: '/', tag: 'hw-daily' }) });
    }
    const r = await P.sendAll(jobs, { ttl: 43200, urgency: 'normal' });
    await P.removeEndpoints(cfg, r.dead);
    res.status(200).json({ ok: true, rows: rows.length, targeted: jobs.length, sent: r.sent, failed: r.failed, removed: r.dead.length, remaining: r.remaining });
  } catch (e) { console.error('cron error:', e.message); res.status(500).json({ error: 'เกิดข้อผิดพลาด' }); }
};
