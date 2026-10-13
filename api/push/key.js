module.exports = (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push is not configured' });
  return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY });
};
