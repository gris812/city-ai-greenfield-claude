/*
 * Telvey WebApp service worker (scope /app).
 *  - App shell: network-first for /app navigations, cached fallback when offline.
 *  - Static build assets (/_next/static, /brand, /guides, fonts): cache-first (immutable, hashed).
 *  - Narration audio (/v1/audio/<hash>.mp3, content-addressed + immutable): cache-first, bounded.
 *  - Demo fixtures (/demo/*): stale-while-revalidate (offline demo mode keeps working).
 * API calls (sessions, WebSocket, admin) are never cached.
 */
const VERSION = 'v1';
const SHELL = `telvey-shell-${VERSION}`;
const STATIC = `telvey-static-${VERSION}`;
const AUDIO = `telvey-audio-${VERSION}`;
const AUDIO_MAX = 300;
const SHELL_URLS = ['/app', '/app/history', '/app/settings', '/manifest.webmanifest', '/brand/app-icon-192.png', '/brand/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('telvey-') && !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && (res.type === 'basic' || res.type === 'cors')) c.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (/\/v1\/audio\/[^/]+\.(mp3|ogg|wav|m4a)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req, AUDIO).then((r) => (trim(AUDIO, AUDIO_MAX), r)));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' && url.pathname.startsWith('/app')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/app')) || Response.error()),
    );
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brand/') || url.pathname.startsWith('/guides/')) {
    e.respondWith(cacheFirst(req, STATIC));
    return;
  }
  if (url.pathname.startsWith('/demo/')) {
    e.respondWith(staleWhileRevalidate(req, STATIC));
  }
});
