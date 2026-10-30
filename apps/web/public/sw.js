// AuditOS app shell worker. It keeps only public files: the offline page, the AuditOS icons and
// the hashed static files. It never stores a page, /api/* or anything that belongs to a signed-in person.
const VERSION = 'aos-shell-v1';
const PRECACHE = ['/offline', '/icons/auditos.svg', '/icons/auditos-192.png', '/icons/auditos-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStatic(path) {
  return (path.startsWith('/_next/static/') && !path.startsWith('/_next/static/webpack/')) || path.startsWith('/icons/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Pages are never stored. When the network fails, the plain offline page is shown instead.
    event.respondWith(fetch(request).catch(() => caches.match('/offline')));
    return;
  }

  if (isStatic(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((response) => {
              if (response.ok && response.type === 'basic') cache.put(request, response.clone());
              return response;
            }),
        ),
      ),
    );
  }
  // Everything else, including /api/ and /site.webmanifest, goes straight to the network.
});
