const CACHE_VERSION = "pwa-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("pwa-") && !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate" && url.pathname.startsWith("/game")) {
    event.respondWith(handleGameNavigation(request));
    return;
  }

  // Avoid caching Next build artifacts. Serving stale JS/CSS across deployments
  // can cause client/server action manifest mismatches after a release.
  if (shouldBypassCache(url.pathname)) {
    return;
  }

  if (isRuntimeCacheableAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function handleGameNavigation(request) {
  try {
    return await fetch(request, { cache: "no-store" });
  } catch {
    const offline = await caches.match("/offline.html");
    return offline || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const network = await networkPromise;
  return network || Response.error();
}

function shouldBypassCache(pathname) {
  return pathname.startsWith("/_next/");
}

function isRuntimeCacheableAsset(pathname) {
  return /\.(?:png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|otf)$/i.test(pathname);
}
