// รับกำหนดส่งการบ้านจากเครื่องผู้ใช้ เก็บไว้ให้ cron ส่งแจ้งเตือนตอนเช้า
const ALLOWED = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    let body; try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) { return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' }); }
    if (JSON.stringify(body).length > 30000) return res.status(413).json({ error: 'ข้อมูลใหญ่เกินไป' });
    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return res.status(400).json({ error: 'subscription ไม่ถูกต้อง' });
    let host; try { const u = new URL(sub.endpoint); if (u.protocol !== 'https:') throw 0; host = u.hostname; } catch (e) { return res.status(400).json({ error: 'endpoint ไม่ถูกต้อง' }); }
    if (!ALLOWED.some(re => re.test(host))) return res.status(400).json({ error: 'ไม่รองรับ push service นี้' });
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า Supabase' });
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 60).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.due)).map(x => ({
      id: String(x.id || '').slice(0, 40), title: String(x.title || '').slice(0, 80), subj: String(x.subj || '').slice(0, 60), due: x.due, time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : ''
    }));
    const H = { apikey: key, Authorization: `Bearer ${key}` };
    const ep = encodeURIComponent(sub.endpoint);
    const r = items.length
      ? await fetch(`${url}/rest/v1/push_homework?on_conflict=endpoint`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ endpoint: sub.endpoint, subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, items, updated_at: new Date().toISOString() }) })
      : await fetch(`${url}/rest/v1/push_homework?endpoint=eq.${ep}`, { method: 'DELETE', headers: H });
    if (!r.ok) { console.error('hw-sync failed:', r.status); return res.status(502).json({ error: 'บันทึกไม่สำเร็จ' }); }
    res.status(200).json({ ok: true, n: items.length });
  } catch (e) { console.error('hw-sync error:', e.message); res.status(500).json({ error: 'เกิดข้อผิดพลาด' }); }
};
