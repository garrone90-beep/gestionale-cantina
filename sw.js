/* Cantina Pratica — service worker: solo notifiche (nessuna copia offline dei dati) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Cantina Pratica', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cantina Pratica', {
    body: d.body || '', icon: '/icone/icona-192.png', badge: '/icone/icona-badge-96.png',
    tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (new URL(c.url).origin === self.location.origin) { try { await c.navigate(url); } catch (x) {} return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
