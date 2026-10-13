# ตั้งค่า Push Notification สำหรับ Content Hub

## 1) ติดตั้งแพ็กเกจ
รัน `npm install` ในโฟลเดอร์โปรเจกต์ แล้ว Deploy ใหม่บน Vercel

## 2) สร้างฐานข้อมูล Supabase
สร้างโปรเจกต์ที่ https://supabase.com/dashboard แล้วไป SQL Editor รัน:

```sql
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text unique not null,
  subscription jsonb not null,
  created_at timestamptz default now()
);
alter table public.push_subscriptions enable row level security;
```

API ใช้ Service Role Key ฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามใส่ key นี้ในหน้าเว็บ

## 3) สร้าง VAPID keys
รัน `npx web-push generate-vapid-keys` ในเครื่อง แล้วเก็บ Public/Private Key

## 4) เพิ่ม Environment Variables ใน Vercel
- `APP_ORIGIN` = URL จริงของเว็บ เช่น `https://your-site.vercel.app` (ไม่มี slash ท้าย)
- `SUPABASE_URL` = Project URL
- `SUPABASE_SERVICE_ROLE_KEY` = Service Role/secret key ฝั่ง server ของ Supabase
- `VAPID_PUBLIC_KEY` = VAPID Public Key
- `VAPID_PRIVATE_KEY` = VAPID Private Key
- `VAPID_SUBJECT` = เช่น `mailto:admin@example.com`
- `PUSH_ADMIN_TOKEN` = สร้าง token สุ่มยาวอย่างน้อย 32 bytes

จากนั้น Redeploy โปรเจกต์

## 5) สมัครรับแจ้งเตือน
เปิดเว็บบน HTTPS แล้วกดปุ่ม “เปิดแจ้งเตือน” มุมล่างขวา ผู้ใช้ต้องอนุญาต Notification เอง

## 6) ส่งทดสอบจาก Terminal
```bash
curl -X POST 'https://your-site.vercel.app/api/push/send' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_PUSH_ADMIN_TOKEN' \
  -d '{"title":"ประกาศใหม่","body":"มีเนื้อหาวิชาใหม่แล้ว","url":"/"}'
```

อย่าเปิดเผย `PUSH_ADMIN_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` หรือ `VAPID_PRIVATE_KEY`

## ข้อจำกัด
- ต้องทดสอบบนอุปกรณ์จริง; การส่งถึงและเวลาแจ้งเตือนขึ้นกับเบราว์เซอร์/ระบบปฏิบัติการ
- บน iPhone ต้องเพิ่มเว็บไปยัง Home Screen และใช้ระบบปฏิบัติการ/เบราว์เซอร์ที่รองรับ Web Push
- Endpoint ส่งประกาศนี้ใช้ token ลับ เหมาะกับการทดสอบ/งานส่วนตัว หากเปิดให้แอดมินใช้งานผ่าน UI จริง ให้เชื่อมกับระบบล็อกอินและ authorization ของเว็บก่อน
- สำหรับผู้สมัครจำนวนมาก ควรทำ queue/batch sending
