/* ============================================================
   Service Worker для «Вордли»
   Стратегия:
     • Навигация (HTML) — network-first с фолбэком на кэш.
     • Остальные GET — stale-while-revalidate.
     • POST и прочее — не трогаем.
   ============================================================ */

const CACHE_NAME   = 'wordle-ru-v4';
const CACHE_PREFIX = 'wordle-ru-';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.png'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        PRECACHE_URLS.map(async url => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (e) { /* пропускаем отсутствующие */ }
        })
      );
      await self.skipWaiting();
    })()
  );
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});

/* ---------- СТРАТЕГИИ ---------- */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && new URL(request.url).origin === self.location.origin) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cached = await cache.match(request)
                || await cache.match('./')
                || await cache.match('./index.html');
    if (cached) return cached;

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Офлайн</title>' +
      '<style>body{font-family:sans-serif;background:#0f1115;color:#e9edf3;' +
      'display:flex;align-items:center;justify-content:center;height:100vh;' +
      'margin:0;text-align:center}</style>' +
      '<div><h1>Нет соединения</h1><p>Откройте приложение при подключении к сети —<br>' +
      'дальше оно будет работать офлайн.</p></div>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.ok &&
          new URL(request.url).origin === self.location.origin) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await networkPromise) || new Response('', { status: 504 });
}

/* ---------- MESSAGE ---------- */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});