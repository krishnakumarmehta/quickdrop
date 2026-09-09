const CACHE_NAME = 'quickdrop-v1';
const APP_SHELL = [
  './', './index.html', './style.css', './client.js', './manifest.json', './icon.svg',
  './img/mask-side.jpg', './img/space-thrusters.jpg', './img/night-flight.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for the static app shell only. This service worker does NOT
// intercept the WebSocket signaling connection or any WebRTC traffic -
// those are unaffected and always go live/direct.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
