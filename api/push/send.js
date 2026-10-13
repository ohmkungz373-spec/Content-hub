const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.PUSH_ADMIN_TOKEN || req.headers.authorization !== `Bearer ${process.env.PUSH_ADMIN_TOKEN}`) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return res.status(503).json({ error: 'Push is not configured' });
  const { title, body, url = '/' } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 100 || typeof body !== 'string' || !body.trim() || body.length > 500 || typeof url !== 'string' || url.length > 2000) return res.status(400).json({ error: 'Invalid notification' });
  let target;
  try { target = new URL(url, process.env.APP_ORIGIN); if (target.origin !== process.env.APP_ORIGIN) throw new Error('External URL'); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const { data, error } = await db.from('push_subscriptions').select('id, subscription'); if (error) throw error;
    let sent=0, failed=0, removed=0;
    for (const row of (data || [])) {
      try { await webpush.sendNotification(row.subscription, JSON.stringify({ title:title.trim(), body:body.trim(), url:target.pathname+target.search+target.hash }), { TTL:86400 }); sent++; }
      catch (e) {
        failed++;
        if (e.statusCode === 404 || e.statusCode === 410) { const d = await db.from('push_subscriptions').delete().eq('id', row.id); if (!d.error) removed++; }
        else console.error('push delivery failed:', e.statusCode || e.message);
      }
    }
    return res.status(200).json({ total:(data||[]).length, sent, failed, removed });
  } catch (e) { console.error('push send error:', e.message); return res.status(500).json({ error:'Failed to send notifications' }); }
};
