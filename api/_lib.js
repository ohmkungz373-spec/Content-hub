// api/_lib.js — ตัวช่วยร่วม (ขึ้นต้นด้วย _ จึงไม่ถูกเปิดเป็น endpoint)
const crypto = require('crypto');
const webpush = require('web-push');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error('ยังไม่ได้เชื่อมฐานข้อมูล Redis (KV_REST_API_URL / KV_REST_API_TOKEN)');
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const hashEndpoint = e => crypto.createHash('sha256').update(e).digest('hex').slice(0, 40);

function initPush() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) throw new Error('ยังไม่ได้ตั้ง VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return webpush;
}

const body = req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}));

module.exports = { redis, hashEndpoint, initPush, body };
