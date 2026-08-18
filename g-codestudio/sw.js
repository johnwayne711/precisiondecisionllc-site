const CACHE_NAME = "verify-app-v43";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.mjs",
  "./compare.mjs",
  "./view3d.mjs",
  "./graphics-quality.mjs",
  "./render-scheduler.mjs",
  "./interaction.mjs",
  "./editor-search.mjs",
  "./geometry-inspector.mjs",
  "./tool-assembly.mjs",
  "./gcode.mjs",
  "./runtime.mjs",
  "./simulation.mjs",
  "./units.mjs",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    APP_ASSETS.map((asset) => new Request(asset, {cache: "reload"})),
  )));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request, {cache: "no-cache"})
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))),
  );
});
