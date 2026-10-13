
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const { subscription } = req.body || {};

    if (
      !subscription ||
      typeof subscription.endpoint !== 'string' ||
      !subscription.endpoint.startsWith('https://') ||
      !subscription.keys?.p256dh ||
      !subscription.keys?.auth
    ) {
      return res.status(400).json({
        error: 'ข้อมูล Push Subscription ไม่ถูกต้อง'
      });
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
      return res.status(500).json({
        error: 'ยังไม่ได้ตั้งค่า Supabase บน Vercel'
      });
    }

    const response = await fetch(
      `${url}/rest/v1/push_subscriptions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          subscription
        })
      }
    );

    if (!response.ok) {
      console.error(
        'Supabase insert failed:',
        response.status
      );

      return res.status(502).json({
        error: 'บันทึกข้อมูลการแจ้งเตือนไม่สำเร็จ'
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Push subscription error:', error.message);

    return res.status(500).json({
      error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์'
    });
  }
};
