// RunFinder SW — network-first para sempre ter conteúdo atualizado
const CACHE = 'runfinder-v3';

self.addEventListener('install', e => {
  self.skipWaiting(); // Ativa imediatamente sem esperar aba fechar
});

self.addEventListener('activate', e => {
  // Apaga todos os caches antigos
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // APIs e fontes externas: sempre network
  if (
    e.request.url.includes('workers.dev') ||
    e.request.url.includes('nominatim') ||
    e.request.url.includes('fonts.googleapis') ||
    e.request.url.includes('plausible')
  ) return;

  // App shell: network-first, cache como fallback offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
