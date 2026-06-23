const CACHE = 'rf-v6';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if(e.request.url.includes('workers.dev') ||
     e.request.url.includes('nominatim') ||
     e.request.url.includes('fonts.goog') ||
     e.request.url.includes('plausible')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if(res.ok){ const c=res.clone(); caches.open(CACHE).then(ca=>ca.put(e.request,c)); }
      return res;
    }).catch(()=>caches.match(e.request))
  );
});
