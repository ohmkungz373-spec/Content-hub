# Content Hub

## แก้ไข/เพิ่มบทเรียน (ทำงานเหมือนเดิม)
1. เปิด `content/<ชื่อวิชา>/`
2. ใส่ไฟล์ .html, .htm, .md, .markdown หรือ .txt
3. ลำดับบทดูจากชื่อไฟล์ เช่น 01-, 02-, 03-
4. HTML ใช้ `<title>` เป็นชื่อบท / Markdown ใช้หัวข้อ `#` เป็นชื่อบท

## รันดูตัวอย่างในเครื่อง (แบบ server เดิม)
```
npm start
```
เปิด http://localhost:3000 — หน้านี้จะสแกนโฟลเดอร์ content/ สดทุกครั้งที่รีเฟรช เหมาะกับตอนแก้ไขเนื้อหา

## Deploy ขึ้น Vercel
โปรเจกต์นี้ถูกปรับให้ deploy บน Vercel แบบ static site (ไม่ใช้ serverless function เลย
จึงไม่มีปัญหาเรื่อง filesystem/permission ของ Vercel functions):

1. Push โปรเจกต์นี้ขึ้น GitHub (หรือ GitLab/Bitbucket)
2. ไปที่ https://vercel.com/new แล้วเลือก repo นี้
3. Vercel จะอ่าน `vercel.json` เองแล้ว:
   - รันคำสั่ง build: `node scripts/build.js`
   - เสิร์ฟโฟลเดอร์ผลลัพธ์: `public/`
4. กด Deploy ได้เลย ไม่ต้องตั้งค่าเพิ่ม

ทุกครั้งที่ push โค้ด/เนื้อหาใหม่ Vercel จะรัน build ใหม่ → `scripts/build.js` สแกน
`content/` และ `hub.config.json` ใหม่ทั้งหมด แล้วสร้าง:
- `public/index.html` — หน้าเว็บ (เหมือนเดิมทุกอย่าง)
- `public/hub.json` — ข้อมูลรายวิชา/บทเรียน (แทนที่ endpoint `/api/hub` เดิม)
- `public/content/...` — สำเนาไฟล์บทเรียนทั้งหมด (ไม่รวม README.txt)

## ทำไมต้องเปลี่ยนจาก server.js เป็น build แบบ static
`server.js` เดิมเป็น Node http server ที่ต้องรันตลอดเวลาและอ่านไฟล์จากดิสก์ทุก
request — Vercel ไม่รองรับรูปแบบนี้ (hosting เป็น static/serverless ไม่ใช่เครื่องที่รันเซิร์ฟเวอร์ค้างไว้)
การ build เป็น static site ล่วงหน้าจึงเป็นวิธีที่ตรงกับ Vercel ที่สุด: ไม่มี
serverless function ให้พัง ไม่มีปัญหาไฟล์ไม่ถูก bundle ไม่มีปัญหา content-type ผิด
(ตั้งค่าชัดเจนใน `vercel.json`) — โหลดเร็วกว่าเดิมด้วยเพราะเป็นไฟล์ static ล้วน ๆ

`server.js` ยังเก็บไว้เหมือนเดิมสำหรับรันในเครื่องตอนแก้เนื้อหา (`npm start`)
