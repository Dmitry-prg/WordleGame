/* ============================================================
   Service Worker для «Вордли»
   ------------------------------------------------------------
   Стратегия:
     • Навигация (HTML) — network-first с фолбэком на кэш.
       Это гарантирует, что свежая версия подтянется при онлайне,
       а при отсутствии сети отдастся закэшированная страница.
     • Остальные GET-запросы — stale-while-revalidate.
     • POST и прочие методы — не трогаем.
   ============================================================ */

const CACHE_NAME   = 'wordle-ru-v1';
const CACHE_PREFIX = 'wordle-ru-';

/* Файлы, которые кладём в кэш сразу при установке.
   Всё приложение — это один HTML-файл, поэтому список короткий.
   Если решите вынести словарь в words.json — добавьте его сюда. */
const PRECACHE_URLS = [
  './',
  './index.html',
  './wordle.html'
  // './words.json'   // ← раскомментируйте, если словарь вынесен в файл
];

/* ------------------------------------------------------------
   INSTALL — предзагрузка «оболочки» приложения
   ------------------------------------------------------------ */
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Кэшируем по одному, чтобы один 404 не убил всю установку
      await Promise.all(
        PRECACHE_URLS.map(async url => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (e) {
            // Тихо пропускаем отсутствующие файлы
          }
        })
      );

      // Активируемся немедленно, не дожидаясь закрытия старых вкладок
      await self.skipWaiting();
    })()
  );
});

/* ------------------------------------------------------------
   ACTIVATE — чистим старые версии кэша
   ------------------------------------------------------------ */
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );

      // Берём управление над уже открытыми вкладками
      await self.clients.claim();
    })()
  );
});

/* ------------------------------------------------------------
   FETCH — перехват запросов
   ------------------------------------------------------------ */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Обрабатываем только GET
  if (req.method !== 'GET') return;

  // Только http(s): пропускаем chrome-extension, data:, blob: и т.п.
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  // Навигационные запросы (переход по страницам) — network-first
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Всё остальное — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

/* ------------------------------------------------------------
   СТРАТЕГИИ
   ------------------------------------------------------------ */

/**
 * Network-first:
 *   1. Пытаемся достать из сети.
 *   2. Если получилось — обновляем кэш и возвращаем.
 *   3. Если сеть упала — отдаём из кэша.
 *   4. Если и в кэше нет — минимальная заглушка.
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const fresh = await fetch(request);
    // Кэшируем только успешные ответы того же origin
    if (fresh && fresh.ok && new URL(request.url).origin === self.location.origin) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (e) {
    // Сеть недоступна
    const cached = await cache.match(request)
                || await cache.match('./')
                || await cache.match('./index.html')
                || await cache.match('./wordle.html');

    if (cached) return cached;

    return new Response(
      '<!doctype html><meta charset="utf-8">' +
      '<title>Офлайн</title>' +
      '<style>body{font-family:sans-serif;background:#0f1115;color:#e9edf3;' +
      'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}' +
      '</style>' +
      '<div><h1>Нет соединения</h1>' +
      '<p>Откройте приложение при подключении к сети — <br>' +
      'дальше оно будет работать офлайн.</p></div>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    );
  }
}

/**
 * Stale-while-revalidate:
 *   1. Отдаём из кэша сразу (если есть) — быстро.
 *   2. Параллельно идём в сеть и обновляем кэш для следующих запросов.
 *   3. Если кэша нет — ждём сеть.
 */
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

/* ------------------------------------------------------------
   MESSAGE — позволяет странице попросить активацию новой версии
   ------------------------------------------------------------
   В коде страницы можно вызвать:
     navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
   ------------------------------------------------------------ */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});