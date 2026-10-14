const ALLOWED = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
    catch (e) { return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' }); }
    if (JSON.stringify(body).length > 4000) return res.status(413).json({ error: 'ข้อมูลใหญ่เกินไป' });

    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string')
      return res.status(400).json({ error: 'ข้อมูล Push Subscription ไม่ถูกต้อง' });

    let host;
    try { const u = new URL(sub.endpoint); if (u.protocol !== 'https:') throw 0; host = u.hostname; }
    catch (e) { return res.status(400).json({ error: 'endpoint ไม่ถูกต้อง' }); }
    if (!ALLOWED.some(re => re.test(host))) return res.status(400).json({ error: 'ไม่รองรับ push service นี้' });

    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า Supabase บน Vercel' });

    const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
    const r = await fetch(`${url}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, Prefer: 'resolution=merge-duplicates,return=minimal' },
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
