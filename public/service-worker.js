const VERSION = 'drone-pid-sw-v1';
const PRECACHE_URLS = ['/', '/index.html', '/simplified.html', '/tmp.json'];
const RUNTIME_CACHE = `drone-pid-runtime-${VERSION}`;

async function precacheCoreAssets() {
  const cache = await caches.open(VERSION);
  const results = await Promise.allSettled(
    PRECACHE_URLS.map(async (url) => {
      try {
        await cache.add(url);
        console.log('[sw] Pre-cached', url);
      } catch (error) {
        console.warn('[sw] Failed to pre-cache', url, error);
        throw error;
      }
    })
  );

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.warn('[sw] Pre-cache completed with failures:', failures.length);
  } else {
    console.log('[sw] Pre-cache completed successfully');
  }
}

self.addEventListener('install', (event) => {
  console.log('[sw] Install event');
  self.skipWaiting();
  event.waitUntil(precacheCoreAssets());
});

self.addEventListener('activate', (event) => {
  console.log('[sw] Activate event');
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => key.startsWith('drone-pid-') && key !== VERSION && key !== RUNTIME_CACHE)
          .map((key) => {
            console.log('[sw] Removing old cache', key);
            return caches.delete(key);
          })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    console.log('[sw] Received SKIP_WAITING message');
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/models/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/assets/') || PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch((error) => {
      console.warn('[sw] Network request failed for', request.url, error);
      return cachedResponse;
    });

  return cachedResponse ?? networkPromise;
}
