// Vercel Cron: ทุกวัน 07:00 (เวลาไทย) ส่งแจ้งเตือนการบ้านที่ใกล้ถึง/เลยกำหนด
// ต้องตั้ง Environment Variable: CRON_SECRET (ข้อความสุ่มยาว ๆ) — Vercel จะส่งมาให้เองตอนเรียก cron
const webpush = require('web-push');
const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '').replace(/=+$/, '');
const day = off => new Date(Date.now() + 7 * 3600e3 + off * 864e5).toISOString().slice(0, 10);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'ยังไม่ได้ตั้ง CRON_SECRET' });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  try {
    const sUrl = process.env.SUPABASE_URL, sKey = process.env.SUPABASE_SECRET_KEY;
    const pub = clean(process.env.VAPID_PUBLIC_KEY), priv = clean(process.env.VAPID_PRIVATE_KEY), subj = String(process.env.VAPID_SUBJECT || '').trim().replace(/^["']|["']$/g, '');
    if (!sUrl || !sKey || !pub || !priv || !subj) return res.status(500).json({ error: 'Environment Variables ไม่ครบ' });
    webpush.setVapidDetails(subj, pub, priv);
    const H = { apikey: sKey, Authorization: `Bearer ${sKey}` };
    const rows = [];
    for (let off = 0; off < 10000; off += 1000) {
      const r = await fetch(`${sUrl}/rest/v1/push_homework?select=endpoint,subscription,items&limit=1000&offset=${off}`, { headers: H });
      if (!r.ok) return res.status(502).json({ error: 'อ่านข้อมูลไม่สำเร็จ' });
      const part = await r.json(); rows.push(...part); if (part.length < 1000) break;
    }
    const today = day(0), tmr = day(1), old = day(-2);
    const jobs = [];
    for (const row of rows) {
      const its = (row.items || []).filter(x => x.due >= old && x.due <= tmr);
      if (!its.length) continue;
      const t = its.filter(x => x.due === today), n = its.filter(x => x.due === tmr), o = its.filter(x => x.due < today);
      const f = x => (x.subj ? x.subj + ': ' : '') + x.title + (x.time ? ` (${x.time} น.)` : '');
      const lines = [];
      if (o.length) lines.push('เลยกำหนด: ' + o.map(f).join(', '));
      if (t.length) lines.push('ส่งวันนี้: ' + t.map(f).join(', '));
      if (n.length) lines.push('ส่งพรุ่งนี้: ' + n.map(f).join(', '));
      jobs.push({ row, payload: JSON.stringify({ title: `การบ้านที่ต้องส่ง ${its.length} งาน`, body: lines.join('\n').slice(0, 300), url: '/', tag: 'hw-daily' }) });
    }
    let sent = 0, failed = 0; const dead = [];
    for (let i = 0; i < jobs.length; i += 20) {
      const out = await Promise.allSettled(jobs.slice(i, i + 20).map(j => webpush.sendNotification(j.row.subscription, j.payload, { TTL: 43200 })));
      out.forEach((o, k) => { if (o.status === 'fulfilled') sent++; else { failed++; const c = o.reason && o.reason.statusCode; if (c === 404 || c === 410) dead.push(jobs[i + k].row.endpoint); } });
    }
    await Promise.allSettled(dead.map(ep => fetch(`${sUrl}/rest/v1/push_homework?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE', headers: H })));
    res.status(200).json({ ok: true, rows: rows.length, sent, failed, removed: dead.length });
  } catch (e) { console.error('cron error:', e.message); res.status(500).json({ error: 'เกิดข้อผิดพลาด' }); }
};
