// Dortmund wäscht: Push-Benachrichtigungen für neue Aufträge
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "Dortmund wäscht", {
    body: data.body || "Es gibt einen neuen Auftrag.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/#auftraege" },
    tag: "neuer-auftrag",
    renotify: true
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const tab of tabs) {
      if (tab.url.startsWith(self.location.origin)) { await tab.navigate(url); return tab.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
