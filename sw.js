// ============================================================
// Service worker — offline shell for the installable (PWA) app
// ============================================================
// Strategy, chosen for a single frequently-edited static page:
//
//   • Same-origin GET (the navigation, index.html, metrics.js,
//     pokemon_data.xlsx, the manifest and icons) → NETWORK-FIRST, falling back
//     to cache. An online visitor therefore always gets the freshest code — the
//     classic "a PWA served me a months-old app" trap is avoided — while an
//     offline visitor still gets the last-known shell and data.
//   • The pinned CDN libraries and Google Fonts → CACHE-FIRST. Their URLs carry
//     a version, so they're immutable; caching them is what lets the charts and
//     type render offline.
//   • Everything else — Supabase (auth + the shared/private data) and the FX
//     rate API — is BYPASSED (no respondWith): it's dynamic and per-user, must
//     never be served stale or cross-contaminate another session, and writes
//     (POST) must always hit the network.
//
// Bump CACHE when the precached shell list changes so `activate` drops the old
// one. Kept dependency-free and framework-free, like the rest of the app.

const CACHE = 'sta-shell-v1';

// The minimum to paint the app offline on the very first offline load. The CDN
// libs are added lazily (cache-first) on the first online visit rather than
// precached, so a CDN blip during install can't fail the whole registration.
const SHELL = [
  './',
  './index.html',
  './metrics.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Cross-origin hosts whose responses are safe to cache (immutable, versioned).
const CACHEABLE_HOSTS = new Set([
  'cdnjs.cloudflare.com',   // Chart.js, SheetJS
  'fonts.googleapis.com',   // Google Fonts CSS
  'fonts.gstatic.com',      // Google Fonts files
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is atomic; keep the shell tiny and same-origin so it can't flake.
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Put a clone in the cache, best-effort (never let a cache write reject the
// response the page is waiting on).
function cachePut(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;                 // writes always hit network
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // Network-first: fresh when online, cached shell when offline. A failed
    // navigation falls back to the cached index so the app still opens.
    event.respondWith(
      fetch(request)
        .then((res) => cachePut(request, res))
        .catch(() => caches.match(request)
          .then((hit) => hit || (request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
    return;
  }

  if (CACHEABLE_HOSTS.has(url.host)) {
    // Cache-first for the immutable, versioned CDN assets.
    event.respondWith(
      caches.match(request).then((hit) =>
        hit || fetch(request).then((res) => cachePut(request, res)))
    );
    return;
  }

  // Supabase, the FX API, anything else: leave it to the network untouched.
});
