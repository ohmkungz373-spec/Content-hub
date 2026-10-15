const { validToken } = require('./_auth');
const P = require('./_push');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
    catch (e) { return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' }); }

    if (!validToken(body.token)) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบแอดมินใหม่' });

    const title = String(body.title || '').trim().slice(0, 100);
    const message = String(body.message || '').trim().slice(0, 500);
    const targetUrl = String(body.url || '/').trim() || '/';
    if (!title || !message) return res.status(400).json({ error: 'กรุณาระบุหัวข้อและข้อความ' });
    if (!targetUrl.startsWith('/') || targetUrl.startsWith('//') || targetUrl.includes('\\'))
      return res.status(400).json({ error: 'URL ต้องเป็นเส้นทางภายในเว็บ' });

    const cfg = P.setup();                       // ตรวจ env + VAPID คู่กันจริง + subject ถูกรูปแบบ
    if (cfg.error) return res.status(500).json({ error: cfg.error });

    let rows;
    try { rows = await P.fetchAll(cfg, 'push_subscriptions', 'endpoint,subscription', 'created_at.asc'); }
    catch (e) { console.error('Supabase query failed:', e.message); return res.status(502).json({ error: 'อ่านข้อมูลผู้รับแจ้งเตือนไม่สำเร็จ' }); }

    const payload = JSON.stringify({ title, body: message, url: targetUrl });
    const r = await P.sendAll(rows.map(x => ({ endpoint: x.endpoint, subscription: x.subscription, payload })), { ttl: 86400, urgency: 'normal' });
    await P.removeEndpoints(cfg, r.dead);

    return res.status(200).json({ ok: true, total: rows.length, sent: r.sent, failed: r.failed, removed: r.dead.length, remaining: r.remaining, reasons: r.reasons });
  } catch (e) {
    console.error('Push send error:', e.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการส่งแจ้งเตือน' });
  }
};
