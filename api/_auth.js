// ตั้งรหัสผ่านแอดมินที่นี่ที่เดียว (ใช้ร่วมกันทั้ง admin.js และ push-send.js)
// ถ้าจะเปลี่ยนรหัส แก้บรรทัดล่างแล้ว commit
const crypto = require('crypto');

const PASS = 'zazaq123';
const SECRET = 'hub-admin:' + PASS;

const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function validToken(t) {
  const [exp, sig] = String(t || '').split('.');
  return !!(exp && sig && safeEq(sig, sign(exp)) && Number(exp) > Date.now());
}
module.exports = { PASS, SECRET, validToken };
