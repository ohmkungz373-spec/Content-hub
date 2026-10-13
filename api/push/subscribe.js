const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '', { auth: { persistSession: false } });
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const origin = req.headers.origin;
  if (origin && origin !== process.env.APP_ORIGIN) return res.status(403).json({ error: 'Invalid origin' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({ error: 'Database is not configured' });
  try {
    const sub = req.body;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return res.status(400).json({ error: 'Invalid subscription' });
    if (!sub.endpoint.startsWith('https://')) return res.status(400).json({ error: 'Invalid endpoint' });
    const { error } = await db.from('push_subscriptions').upsert({ endpoint: sub.endpoint, subscription: sub }, { onConflict: 'endpoint' });
    if (error) throw error;
    return res.status(201).json({ ok: true });
  } catch (e) { console.error('subscribe error:', e.message); return res.status(500).json({ error: 'Could not save subscription' }); }
};
