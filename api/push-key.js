// ส่ง VAPID Public Key ให้หน้าเว็บ (เป็นคีย์สาธารณะ ปลอดภัย)
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const k = String(process.env.VAPID_PUBLIC_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/=+$/, '');
  if (!k) return res.status(500).json({ error: 'ยังไม่ได้ตั้ง VAPID_PUBLIC_KEY' });
  res.status(200).json({ publicKey: k });
};
