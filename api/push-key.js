// ส่ง VAPID Public Key ให้หน้าเว็บ (เป็นคีย์สาธารณะ ปลอดภัย)
module.exports = (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const k = String(process.env.VAPID_PUBLIC_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/=+$/, '');
  // error ห้ามถูกแคช (เดิมแคช 1 วันทั้งที่เป็น 500) / ถ้าสำเร็จแคช 1 ชม. เผื่อเปลี่ยนคีย์แล้วเครื่องผู้ใช้อัปเดตทัน
  if (!k) { res.setHeader('Cache-Control', 'no-store'); return res.status(500).json({ error: 'ยังไม่ได้ตั้ง VAPID_PUBLIC_KEY' }); }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({ publicKey: k });
};
