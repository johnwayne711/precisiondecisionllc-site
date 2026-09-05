const CACHE_PREFIX = "verify-app-";
const CACHE_NAME = "verify-app-v59";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.mjs",
  "./compare.mjs",
  "./dxf-import.mjs",
  "./profile-compare.mjs",
  "./reference-display-budget.mjs",
  "./step-import.mjs",
  "./step-worker-client.mjs",
  "./step-kernel-worker.mjs",
  "./step-kernel-runtime.mjs",
  "./view3d.mjs",
  "./graphics-quality.mjs",
  "./render-scheduler.mjs",
  "./interaction.mjs",
  "./editor-search.mjs",
  "./geometry-inspector.mjs",
  "./tool-assembly.mjs",
  "./tool-library.mjs",
  "./live-tool-library.mjs",
  "./milling-tool-library.mjs",
  "./milling-tool-preview.mjs",
  "./program-tools.mjs",
  "./machine-semantics.mjs",
  "./gcode.mjs",
  "./mill-gcode.mjs",
  "./mill-view.mjs",
  "./live-view.mjs",
  "./live-stock.mjs",
  "./runtime.mjs",
  "./simulation.mjs",
  "./units.mjs",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
const CAD_KERNEL_ASSETS = [
  "./vendor/occt/3.0.2/asset-manifest.json",
  "./vendor/occt/3.0.2/opencascade_single.js",
  "./vendor/occt/3.0.2/opencascade_single.wasm.part-000",
  "./vendor/occt/3.0.2/opencascade_single.wasm.part-001",
  "./vendor/occt/3.0.2/opencascade_single.wasm.part-002",
];
const APP_ASSET_URLS = new Set(APP_ASSETS.map((asset) => new URL(asset, self.registration.scope).href));
const CAD_KERNEL_ASSET_URLS = new Set(CAD_KERNEL_ASSETS.map((asset) => new URL(asset, self.registration.scope).href));

function isOwnedAppAsset(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin
    && !url.search
    && APP_ASSET_URLS.has(url.href);
}

function isOwnedCadKernelAsset(request) {
  if (request.method !== "GET" || request.headers.has("range")) return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin
    && !url.search
    && CAD_KERNEL_ASSET_URLS.has(url.href);
}

async function fetchOwnedCadKernelAsset(event) {
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
  } catch {
    // Cache availability must not prevent an integrity-checked network load.
  }

  const response = await fetch(event.request, {cache: "no-cache"});
  const responseUrl = response.url ? new URL(response.url) : null;
  const requestUrl = new URL(event.request.url);
  const exactSameOriginResponse = responseUrl
    && !response.redirected
    && responseUrl.href === requestUrl.href
    && responseUrl.origin === self.location.origin;
  if (cache && response.ok && response.type !== "opaque" && exactSameOriginResponse) {
    const copy = response.clone();
    event.waitUntil(cache.put(event.request, copy).catch(() => undefined));
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    APP_ASSETS.map((asset) => new Request(asset, {cache: "reload"})),
  )));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", (event) => {
  if (isOwnedAppAsset(event.request)) {
    event.respondWith(
      fetch(event.request, {cache: "no-cache"})
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  if (!isOwnedCadKernelAsset(event.request)) return;
  event.respondWith(fetchOwnedCadKernelAsset(event));
});
