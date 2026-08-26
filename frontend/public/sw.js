/**
 * Hallelujah In The City - offline shell.
 *
 * The previous version of this file registered and then did nothing: it passed
 * every request straight through to the network, so it provided no offline
 * support at all. It also asked for a scope of /system/ while being served from
 * /system/public/, which a browser refuses outright, so it never even installed.
 *
 * The one real danger with caching this app is serving somebody a stale build.
 * That has already happened here once by way of ordinary browser cache, and a
 * service worker is quite capable of making it permanent. So the strategy is
 * chosen per kind of request rather than applied across the board:
 *
 *   assets/*      cache first. Vite puts a content hash in the filename, so
 *                 index-CLk1cBB0.js can never mean two different things. A new
 *                 build is a new name, and a name that is already cached is by
 *                 definition still correct.
 *   api/*         network only. Church data is the last thing that should ever
 *                 be answered from a stale copy - giving times, attendance,
 *                 someone's phone number. Offline it fails, which is honest.
 *   navigation    network first, cache as fallback. The network always gets to
 *                 hand over a newer index.html; the cached copy is only used
 *                 when there is no network at all.
 *
 * Bump CACHE_VERSION to retire every old cache on the next activate.
 */
const CACHE_VERSION = 'hitc-v1';
const SHELL = 'index.html';

/**
 * Brand files that sit at the top of /system/public/ rather than in assets/,
 * so their names carry no content hash. Without these the offline sign-in page
 * renders with a broken image where the church logo should be. They are served
 * from cache and refreshed in the background, so a replaced logo corrects
 * itself on the following load rather than needing a version bump.
 */
const STATIC_FILES = ['logo.png', 'logo-system.png', 'favicon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll([SHELL, ...STATIC_FILES]))
      .catch(() => { /* first load offline - nothing to warm yet */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never answer church data from a cache.
  if (url.pathname.includes('/api/')) return;

  // Hashed build output. Same name always means the same bytes.
  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Unhashed brand files. Answer from cache so they survive offline, but fetch
  // a fresh copy in the background so a replaced logo takes effect next load.
  if (STATIC_FILES.some((f) => url.pathname.endsWith('/' + f))) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const live = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit || Response.error());
        return hit || live;
      })
    );
    return;
  }

  // Pages. A newer build must always win when the network is there.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(SHELL, copy));
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit || Response.error()))
    );
  }
});
