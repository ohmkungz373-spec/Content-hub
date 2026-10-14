// ใช้ร่วมกันใน api/ (ไฟล์ขึ้นต้น _ ไม่ถูก Vercel นับเป็น function)
const crypto = require('crypto');
const PASS = process.env.ADMIN_PASSWORD;
const SECRET = process.env.ADMIN_SECRET;
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function validToken(t) {
  if (!PASS || !SECRET) return false;
  const [exp, sig] = String(t || '').split('.');
  return !!(exp && sig && safeEq(sig, sign(exp)) && Number(exp) > Date.now());
}
module.exports = { validToken };
