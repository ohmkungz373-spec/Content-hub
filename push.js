(() => {
  const css = `#chPushBtn{position:fixed;right:14px;bottom:18px;z-index:45;border:1px solid #38bdf8;background:linear-gradient(135deg,#2563eb,#0891b2);color:white;border-radius:999px;padding:12px 16px;font:600 14px inherit;box-shadow:0 8px 28px #0284c755;cursor:pointer}#chPushBtn:disabled{opacity:.7}#chPushToast{position:fixed;right:14px;bottom:76px;z-index:46;max-width:calc(100vw - 28px);padding:11px 14px;border-radius:12px;background:#111827;color:white;font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 28px #0004}`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const btn = document.createElement('button'); btn.id = 'chPushBtn'; btn.type = 'button'; btn.textContent = '🔔 เปิดแจ้งเตือน'; btn.setAttribute('aria-label','เปิดรับการแจ้งเตือน');
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));
  function toast(msg) { document.getElementById('chPushToast')?.remove(); const el=document.createElement('div'); el.id='chPushToast'; el.textContent=msg; document.body.appendChild(el); setTimeout(()=>el.remove(),4500); }
  function decodeKey(s) { const pad='='.repeat((4-s.length%4)%4); const raw=atob((s+pad).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from([...raw].map(c=>c.charCodeAt(0))); }
  btn.addEventListener('click', async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { toast('เบราว์เซอร์นี้ไม่รองรับ Push Notification'); return; }
    btn.disabled=true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { toast('ยังไม่ได้อนุญาตการแจ้งเตือน'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const kr = await fetch('/api/push/key'); if(!kr.ok) throw new Error('โหลด VAPID key ไม่สำเร็จ');
      const {publicKey}=await kr.json(); if(!publicKey) throw new Error('ยังไม่ได้ตั้ง VAPID_PUBLIC_KEY ใน Vercel');
      let sub=await reg.pushManager.getSubscription();
      if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(publicKey)});
      const sr=await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});
      if(!sr.ok) { const d=await sr.json().catch(()=>({})); throw new Error(d.error||'บันทึกการสมัครรับแจ้งเตือนไม่สำเร็จ'); }
      toast('เปิดรับการแจ้งเตือนแล้ว 🎉'); btn.textContent='🔔 เปิดรับแล้ว';
    } catch(e) { console.error(e); toast(e.message||'เกิดข้อผิดพลาด'); }
    finally { btn.disabled=false; }
  });
})();
