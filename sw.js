const CACHE = 'runfinder-v4';

// Pré-cache mínimo para garantir funcionamento offline
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll([
        './',
        './index.html',
        './manifest.json'
      ])
    )
  );
  self.skipWaiting();
});

// Limpa caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => {
        if (k !== CACHE) return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// Estratégia: network-first com fallback inteligente
