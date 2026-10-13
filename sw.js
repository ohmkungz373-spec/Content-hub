self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Content Hub", {
    body: data.body || "มีประกาศใหม่จาก Content Hub",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let target = new URL("/", self.location.origin);
    try {
      const u = new URL(event.notification.data?.url || "/", self.location.origin);
      if (u.origin === self.location.origin) target = u;
    } catch {}
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (new URL(client.url).origin === target.origin) {
        await client.navigate(target.href); return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
