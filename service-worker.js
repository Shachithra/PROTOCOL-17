// PROTOCOL 17 — service worker
// Cache-first for the local shell. Cross-origin requests (IP lookup,
// TTS model CDN) are never intercepted: the IP lookup must never be cached.

const VERSION = "p17-v1";
const SHELL = `${VERSION}-shell`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./css/base.css",
  "./css/typography.css",
  "./css/horror.css",
  "./css/animations.css",
  "./css/responsive.css",
  "./js/app.js",
  "./js/state.js",
  "./js/utils.js",
  "./js/horror-engine.js",
  "./js/event-engine.js",
  "./js/behavior-engine.js",
  "./js/location-engine.js",
  "./js/memory-engine.js",
  "./js/audio-engine.js",
  "./js/voice-engine.js",
  "./js/ui-engine.js",
  "./js/terminal-engine.js",
  "./workers/tts-worker.js",
  "./assets/textures/grain.png",
  "./assets/textures/noise.png",
  "./assets/textures/scanlines.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL && k.startsWith("p17-")).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // cross-origin: IP lookup, model CDN — always straight to the network.
  if (url.origin !== self.location.origin) return;

  // navigations: network first, offline fallback to the cached shell
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() =>
          caches
            .match("./index.html")
            .then((r) => r || caches.match("./"))
        )
    );
    return;
  }

  // static assets: cache first, then network (and seed the cache)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
