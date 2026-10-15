const P = require('./_push');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
    catch (e) { return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' }); }
    if (JSON.stringify(body).length > 4000) return res.status(413).json({ error: 'ข้อมูลใหญ่เกินไป' });

    const cfg = P.supa();
    if (!cfg) return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า Supabase บน Vercel' });

    // ผู้ใช้ปิดแจ้งเตือน → ลบ subscription ออกจากเซิร์ฟเวอร์ทันที (endpoint เป็น URL ลับเฉพาะเครื่อง จึงใช้ยืนยันความเป็นเจ้าของได้)
    if (body.unsubscribe) {
      if (typeof body.endpoint !== 'string' || !P.validEndpoint(body.endpoint)) return res.status(400).json({ error: 'endpoint ไม่ถูกต้อง' });
      await P.removeEndpoints(cfg, [body.endpoint]);
      return res.status(200).json({ ok: true, removed: true });
    }

    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string')
      return res.status(400).json({ error: 'ข้อมูล Push Subscription ไม่ถูกต้อง' });
    if (!P.validEndpoint(sub.endpoint)) return res.status(400).json({ error: 'endpoint ไม่ถูกต้องหรือไม่รองรับ push service นี้' });

    const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
    const r = await P.sb(cfg, 'push_subscriptions?on_conflict=endpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ endpoint: sub.endpoint, subscription: clean })
    });
    if (!r.ok) {
      console.error('Supabase insert failed:', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return res.status(502).json({ error: 'บันทึกข้อมูลการแจ้งเตือนไม่สำเร็จ' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Push subscription error:', e.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
};
