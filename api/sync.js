// POST /api/sync  { action:'sync'|'unsubscribe', subscription, items:[{id,title,at,time,subj}] }
// เก็บ subscription + รายการการบ้านที่ยังไม่เสร็จของเครื่องนั้น ไว้ให้ /api/cron ใช้ส่งแจ้งเตือน
const { redis, hashEndpoint, body } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const b = body(req);
    const sub = b.subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'no subscription' });
    const id = hashEndpoint(sub.endpoint);

    if (b.action === 'unsubscribe') {
      await redis(['DEL', 'sub:' + id]);
      await redis(['SREM', 'subs', id]);
      return res.json({ ok: true });
    }

    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 200).map(x => ({
      id: String(x.id || '').slice(0, 64),
      title: String(x.title || '').slice(0, 120),
      at: Number(x.at) || 0,
      time: String(x.time || '').slice(0, 5),
      subj: String(x.subj || '').slice(0, 60)
    })).filter(x => x.id && x.at);

    let old = null;
    try { const r = await redis(['GET', 'sub:' + id]); old = r ? JSON.parse(r) : null; } catch (e) {}
    const sent = {};
    if (old && old.sent) for (const k of Object.keys(old.sent)) {
      if (items.some(i => i.id === k.split(':')[0])) sent[k] = old.sent[k];   // เก็บเฉพาะรายการที่ยังอยู่
    }
    await redis(['SET', 'sub:' + id, JSON.stringify({ sub, items, sent, updated: Date.now() })]);
    await redis(['SADD', 'subs', id]);
    res.json({ ok: true, items: items.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
