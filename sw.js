// Service worker. __V__ and __FILES__ are filled in by the server from file mtimes, so every deploy gets a fresh cache.
const V = 'life-__V__', FILES = __FILES__;
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES))));   // no skipWaiting: the page asks the user
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (u.pathname === '/share') { e.respondWith(Response.redirect('/#/capture?' + u.searchParams.toString())); return; }
  const key = e.request.mode === 'navigate' ? '/' : u.pathname + (FILES.includes(u.pathname) ? '' : u.search);
  e.respondWith(caches.match(key).then(hit => hit || fetch(e.request).catch(() => caches.match('/'))));
});
self.addEventListener('push', e => { const d = e.data ? e.data.json() : {}; e.waitUntil(self.registration.showNotification(d.title || 'Life', { body: d.body || '', icon: '/static/icon-192.png', tag: d.tag, data: d })); });
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow('/#/today')); });
