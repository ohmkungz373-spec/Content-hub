// GET /api/vapid → ส่ง public key ให้หน้าเว็บใช้สมัครรับ push
module.exports = (req, res) => {
  const k = process.env.VAPID_PUBLIC_KEY;
  if (!k) return res.status(503).json({ error: 'ยังไม่ได้ตั้ง VAPID_PUBLIC_KEY' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ publicKey: k });
};
