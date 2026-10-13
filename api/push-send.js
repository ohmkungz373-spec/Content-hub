
const crypto = require('crypto');
const webpush = require('web-push');

const PASS = process.env.ADMIN_PASSWORD || 'zazaq123';
const SECRET = process.env.ADMIN_SECRET || ('hub-admin:' + PASS);

const sign = (s) =>
  crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function validToken(token) {
  const [exp, sig] = String(token || '').split('.');
  return !!(
    exp &&
    sig &&
    safeEq(sig, sign(exp)) &&
    Number(exp) > Date.now()
  );
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    if (!validToken(body.token)) {
      return res.status(401).json({
        error: 'กรุณาเข้าสู่ระบบแอดมินใหม่'
      });
    }

    const title = String(body.title || '').trim().slice(0, 100);
    const message = String(body.message || '').trim().slice(0, 500);
    const targetUrl = String(body.url || '/');

    if (!title || !message) {
      return res.status(400).json({
        error: 'กรุณาระบุหัวข้อและข้อความ'
      });
    }

    if (
      !targetUrl.startsWith('/') ||
      targetUrl.startsWith('//') ||
      targetUrl.includes('\\')
    ) {
      return res.status(400).json({
        error: 'URL ต้องเป็นเส้นทางภายในเว็บ'
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    if (!supabaseUrl || !supabaseKey ||
        !publicKey || !privateKey || !subject) {
      return res.status(500).json({
        error: 'กรุณาตรวจสอบ Environment Variables ใน Vercel'
      });
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    const db = await fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?select=subscription`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    if (!db.ok) {
      console.error('Supabase query failed:', db.status);
      return res.status(502).json({
        error: 'อ่านข้อมูลผู้รับแจ้งเตือนไม่สำเร็จ'
      });
    }

    const rows = await db.json();
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({
            title,
            body: message,
            url: targetUrl
          })
        );
        sent++;
      } catch (e) {
        failed++;
        console.error('Push delivery failed:', e.statusCode || e.message);
      }
    }

    return res.status(200).json({
      ok: true,
      total: rows.length,
      sent,
      failed
    });
  } catch (e) {
    console.error('Push send error:', e.message);
    return res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการส่งแจ้งเตือน'
    });
  }
};
