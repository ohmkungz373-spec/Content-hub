// ตัวช่วยกลางของระบบแจ้งเตือน (ไฟล์ขึ้นต้นด้วย _ ไม่ถูกนับเป็น endpoint)
// - เรียก Supabase แบบมี timeout + retry
// - ส่ง push แบบ worker pool + retry เฉพาะ error ชั่วคราว + จำกัดเวลาไม่ให้ฟังก์ชันโดนตัดกลางทาง
const crypto = require('crypto');
const webpush = require('web-push');

const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '').replace(/=+$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALLOWED = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

function validEndpoint(ep) {
  try { const u = new URL(ep); return u.protocol === 'https:' && ALLOWED.some(re => re.test(u.hostname)); }
  catch (e) { return false; }
}

// ตั้งค่า Supabase อย่างเดียว (ไม่ต้องใช้ VAPID) — คืน null ถ้ายังไม่ได้ตั้ง
function supa() {
  const sUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const sKey = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!sUrl || !sKey) return null;
  return { sUrl, sKey, H: { apikey: sKey, Authorization: `Bearer ${sKey}` } };
}

// ตั้งค่า Supabase + VAPID พร้อมตรวจความถูกต้อง — คืน { error } ถ้าตั้งค่าผิด
function setup() {
  const cfg = supa();
  const pub = clean(process.env.VAPID_PUBLIC_KEY), priv = clean(process.env.VAPID_PRIVATE_KEY);
  const subj = String(process.env.VAPID_SUBJECT || '').trim().replace(/^["']|["']$/g, '');
  if (!cfg || !pub || !priv || !subj) return { error: 'กรุณาตรวจสอบ Environment Variables ใน Vercel' };
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(priv, 'base64url'));
    if (ecdh.getPublicKey().toString('base64url') !== pub)
      return { error: 'VAPID_PUBLIC_KEY กับ VAPID_PRIVATE_KEY ไม่ใช่คู่เดียวกัน — ตั้งใหม่ทั้งสองค่าใน Vercel แล้ว Redeploy' };
  } catch (e) {
    return { error: 'VAPID_PRIVATE_KEY รูปแบบไม่ถูกต้อง (ต้องเป็น base64url ยาว 43 ตัว)' };
  }
  try { webpush.setVapidDetails(subj, pub, priv); }
  catch (e) { return { error: 'VAPID_SUBJECT ไม่ถูกต้อง (ต้องขึ้นต้นด้วย mailto: หรือ https://) — ' + e.message }; }
  return cfg;
}

// เรียก PostgREST: timeout 8 วิ, ลองซ้ำเมื่อเครือข่ายล่ม / 429 / 5xx
async function sb(cfg, path, init = {}, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(`${cfg.sUrl}/rest/v1/${path}`, { ...init, headers: { ...cfg.H, ...(init.headers || {}) }, signal: ac.signal });
      if (r.status < 500 && r.status !== 429) return r;
      last = r;
      if (i < tries - 1) await r.text().catch(() => '');
    } catch (e) { last = e; }
    finally { clearTimeout(t); }
    if (i < tries - 1) await sleep(500 * (i + 1));
  }
  if (last && typeof last.status === 'number') return last;
  throw last;
}

// ดึงทั้งตารางเป็นหน้า ๆ (เรียงลำดับเสมอ เพื่อไม่ให้แถวซ้ำ/ตกหล่นระหว่างหน้า)
async function fetchAll(cfg, table, select, order) {
  const rows = [];
  for (let off = 0; off < 20000; off += 1000) {
    const r = await sb(cfg, `${table}?select=${select}&order=${order}&limit=1000&offset=${off}`);
    if (!r.ok) throw new Error(`${table} ${r.status}`);
    const part = await r.json();
    rows.push(...part);
    if (part.length < 1000) break;
  }
  return rows;
}

const netErr = e => !!e && /timeout|timed out|ETIMEDOUT|ECONN|EAI_AGAIN|ENOTFOUND|socket|network|EPIPE/i.test(String(e.code || '') + ' ' + String(e.message || ''));
const transient = e => { const c = e && e.statusCode; return c ? (c === 429 || c >= 500) : netErr(e); };

async function sendOne(job, ttl, urgency) {
  let err;
  for (let i = 0; i < 2; i++) {
    try { return await webpush.sendNotification(job.subscription, job.payload, { TTL: ttl, urgency, timeout: 7000 }); }
    catch (e) {
      err = e;
      if (i === 1 || !transient(e)) break;
      const ra = Number(e && e.headers && e.headers['retry-after']);
      await sleep(Math.min(2000, (ra > 0 ? ra : 0.5) * 1000));
    }
  }
  throw err;
}

// jobs: [{ endpoint, subscription, payload }]
async function sendAll(jobs, { ttl = 86400, urgency = 'normal', budgetMs = Number(process.env.PUSH_BUDGET_MS) || 8000, concurrency = 40 } = {}) {
  const t0 = Date.now(), out = { sent: 0, failed: 0, dead: [], reasons: {}, remaining: 0 };
  let idx = 0;
  const worker = async () => {
    while (idx < jobs.length) {
      if (Date.now() - t0 > budgetMs) return;          // หมดเวลา: หยุดรับงานใหม่ (ดีกว่าโดนตัดแล้วไม่รู้ผล)
      const j = jobs[idx++];
      try { await sendOne(j, ttl, urgency); out.sent++; }
      catch (e) {
        out.failed++;
        const code = e && e.statusCode;
        const why = String(code || (e && e.message) || 'unknown').slice(0, 80) + (e && e.body ? ' | ' + String(e.body).slice(0, 120) : '');
        out.reasons[why] = (out.reasons[why] || 0) + 1;
        if (code === 404 || code === 410) out.dead.push(j.endpoint);   // หมดอายุถาวรเท่านั้นถึงลบ (401/403 อาจเกิดจากตั้งค่าคีย์ผิดชั่วคราว จึงไม่ลบ)
        else console.error('Push delivery failed:', code || (e && e.message));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  out.remaining = Math.max(0, jobs.length - idx);
  return out;
}

// ลบ subscription ที่ตายแล้วออกจากทุกตาราง
async function removeEndpoints(cfg, endpoints, tables = ['push_subscriptions', 'push_homework']) {
  await Promise.allSettled(endpoints.flatMap(ep => tables.map(t => sb(cfg, `${t}?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE' }))));
}

module.exports = { clean, validEndpoint, supa, setup, sb, fetchAll, sendAll, removeEndpoints };
