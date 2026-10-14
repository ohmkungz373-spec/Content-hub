const crypto = require('crypto');
const webpush = require('web-push');
const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '').replace(/=+$/, '');
const { validToken } = require('./_auth');

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

    const sUrl = process.env.SUPABASE_URL, sKey = process.env.SUPABASE_SECRET_KEY;
    const pub = clean(process.env.VAPID_PUBLIC_KEY), priv = clean(process.env.VAPID_PRIVATE_KEY), subj = String(process.env.VAPID_SUBJECT || '').trim().replace(/^["']|["']$/g, '');
    if (!sUrl || !sKey || !pub || !priv || !subj) return res.status(500).json({ error: 'กรุณาตรวจสอบ Environment Variables ใน Vercel' });
    // ตรวจว่า Public/Private เป็นคู่เดียวกันจริง
    try {
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.setPrivateKey(Buffer.from(priv, 'base64url'));
      if (ecdh.getPublicKey().toString('base64url') !== pub)
        return res.status(500).json({ error: 'VAPID_PUBLIC_KEY กับ VAPID_PRIVATE_KEY ไม่ใช่คู่เดียวกัน — ตั้งใหม่ทั้งสองค่าใน Vercel แล้ว Redeploy' });
    } catch (e) {
      return res.status(500).json({ error: 'VAPID_PRIVATE_KEY รูปแบบไม่ถูกต้อง (ต้องเป็น base64url ยาว 43 ตัว)' });
    }
    webpush.setVapidDetails(subj, pub, priv);

    const H = { apikey: sKey, Authorization: `Bearer ${sKey}` };
    // ดึงทั้งหมดเป็นหน้า ๆ (PostgREST จำกัดต่อคำขอ)
    const rows = [];
    for (let off = 0; off < 10000; off += 1000) {
      const r = await fetch(`${sUrl}/rest/v1/push_subscriptions?select=endpoint,subscription&order=created_at.asc&limit=1000&offset=${off}`, { headers: H });
      if (!r.ok) { console.error('Supabase query failed:', r.status); return res.status(502).json({ error: 'อ่านข้อมูลผู้รับแจ้งเตือนไม่สำเร็จ' }); }
      const part = await r.json();
      rows.push(...part);
      if (part.length < 1000) break;
    }

    const payload = JSON.stringify({ title, body: message, url: targetUrl });
    let sent = 0, failed = 0; const dead = [], reasons = {};
    for (let i = 0; i < rows.length; i += 20) {
      const batch = rows.slice(i, i + 20);
      const out = await Promise.allSettled(batch.map(row => webpush.sendNotification(row.subscription, payload, { TTL: 86400, urgency: 'normal' })));
      out.forEach((o, k) => {
        if (o.status === 'fulfilled') sent++;
        else {
          failed++;
          const code = o.reason && o.reason.statusCode;
          const why = String(code || (o.reason && o.reason.message) || 'unknown').slice(0, 80) + (o.reason && o.reason.body ? ' | ' + String(o.reason.body).slice(0, 120) : '');
          reasons[why] = (reasons[why] || 0) + 1;
          if (code === 404 || code === 410) dead.push(batch[k].endpoint);
          else console.error('Push delivery failed:', code || (o.reason && o.reason.message));
        }
      });
    }

    // ลบ subscription ที่หมดอายุ
    await Promise.allSettled(dead.map(ep => fetch(`${sUrl}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE', headers: H })));

    return res.status(200).json({ ok: true, total: rows.length, sent, failed, removed: dead.length, reasons });
  } catch (e) {
    console.error('Push send error:', e.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการส่งแจ้งเตือน' });
  }
};
