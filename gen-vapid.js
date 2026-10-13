// รัน:  node gen-vapid.js   → ได้ VAPID key สำหรับใส่ใน Environment Variables ของ Vercel
const crypto = require('crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' }), prv = privateKey.export({ format: 'jwk' });
const b64u = s => s; // jwk ใช้ base64url อยู่แล้ว
const pubRaw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url');
console.log('VAPID_PUBLIC_KEY=' + pubRaw);
console.log('VAPID_PRIVATE_KEY=' + prv.d);
console.log('VAPID_SUBJECT=mailto:อีเมลของคุณ@example.com');
console.log('CRON_SECRET=' + crypto.randomBytes(24).toString('hex'));
