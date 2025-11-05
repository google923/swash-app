// Swash Service Worker
// Provides offline caching and forwards sync events to the app shell.

const CACHE_NAME = "swash-cache-v16";
const OFFLINE_URLS = [
  "index.html",
  "admin.html",
  "scheduler.html",
  "404.html",
  "manifest.json",
  "style.css",
  "script.js",
  "admin.js",
  "scheduler.js",
  "offline-queue.js",
  "menu.js",
  "assets/favicon-192.png",
  "assets/favicon-512.png",
  "assets/swash-logo.png"
];

// install cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

// activate and clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// fetch fallback
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (!request.url.startsWith(self.location.origin)) return;
  event.respondWith(cacheFirst(request));
});

// background sync
self.addEventListener("sync", async (event) => {
  if (event.tag === "sync-quotes") {
    event.waitUntil(syncOfflineQuotes());
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "QUEUE_QUOTE" && "sync" in self.registration) {
    self.registration.sync.register("sync-quotes").catch(() => {
      // ignore registration errors; foreground sync will retry.
    });
  }
});

async function syncOfflineQuotes() {
  try {
    const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
    clientsList.forEach((client) =>
      client.postMessage({ type: "SYNC_OFFLINE_QUOTES" })
    );
  } catch (err) {
    console.error("Sync failed:", err);
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match("index.html");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
      })
      .catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return caches.match(request);
  }
}