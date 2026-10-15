// รับกำหนดส่งการบ้านจากเครื่องผู้ใช้ เก็บไว้ให้ cron ส่งแจ้งเตือนตอนเช้า
const P = require('./_push');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    let body; try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) { return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' }); }
    if (JSON.stringify(body).length > 30000) return res.status(413).json({ error: 'ข้อมูลใหญ่เกินไป' });
    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return res.status(400).json({ error: 'subscription ไม่ถูกต้อง' });
    if (!P.validEndpoint(sub.endpoint)) return res.status(400).json({ error: 'endpoint ไม่ถูกต้องหรือไม่รองรับ push service นี้' });
    const cfg = P.supa();
    if (!cfg) return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า Supabase' });

    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 60).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.due)).map(x => ({
      id: String(x.id || '').slice(0, 40), title: String(x.title || '').slice(0, 80), subj: String(x.subj || '').slice(0, 60), due: x.due, time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : ''
    }));
    const ep = encodeURIComponent(sub.endpoint);
    const r = items.length
      ? await P.sb(cfg, 'push_homework?on_conflict=endpoint', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ endpoint: sub.endpoint, subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, items, updated_at: new Date().toISOString() }) })
      : await P.sb(cfg, `push_homework?endpoint=eq.${ep}`, { method: 'DELETE' });
    if (!r.ok) { console.error('hw-sync failed:', r.status); return res.status(502).json({ error: 'บันทึกไม่สำเร็จ' }); }
    res.status(200).json({ ok: true, n: items.length });
  } catch (e) { console.error('hw-sync error:', e.message); res.status(500).json({ error: 'เกิดข้อผิดพลาด' }); }
};
