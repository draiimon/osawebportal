const CACHE_VERSION = "osa-static-v1.0.33";
const RUNTIME_CACHE = "osa-runtime-v1.0.14";

const PRECACHE_URLS = [
  "/",
  "/preview",
  "/announcements/",
  "/announcements",
  "/lost-and-found/",
  "/lost-and-found",
  "/about-portal/",
  "/about-portal",
  "/css/osa-design.css?v=40",
  "/css/osa-ai.css?v=52",
  "/assets/js/portal-shell.js?v=44",
  "/assets/js/osa-api-client.js?v=2",
  "/assets/js/osa-chat-loader.js?v=71",
  "/assets/js/osa-chat-widget.js?v=98",
  "/assets/images/eac-emblem.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/css/") ||
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".svg")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(async () => {
          const cachedExact = await caches.match(request);
          if (cachedExact) return cachedExact;
          if (url.pathname === "/" || url.pathname === "/preview") {
            return (await caches.match("/preview")) || (await caches.match("/"));
          }
          const fallbackRoute = url.pathname.replace(/\/$/, "");
          return (
            (await caches.match(fallbackRoute)) ||
            (await caches.match(`${fallbackRoute}/`)) ||
            (await caches.match("/")) ||
            (await caches.match("/preview"))
          );
        })
    );
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw new Error("Network unavailable and no cached response.");
    })
  );
});
