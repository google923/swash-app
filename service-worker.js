// Swash Service Worker
// Provides offline caching and forwards sync events to the app shell.
const CACHE_NAME = 'swash-cache-v55'; // bumped to invalidate stale cached HTML/JS
const OFFLINE_URLS = [
  "/index.html",
  "/pipeline.html",
  "/admin/stats.html",
  "/admin/message-log.html",
  "/add-log.html",
  "/rep/rep-home.html",
  // Embedded quote form (must be cached so iframe works offline)
  "/rep/quote-embed.html",
  "/rep/quote-embed.js",
  "/rep/add-new-customer.html",
  "/rep/scheduler.html",
  "/rep/chat.html",
  "/style.css",
  "/public/firebase-init.js",
  "/auth-check.js",
  "/admin.js",
  "/admin/stats.js",
  "/admin/message-log.js",
  "/add-log.js",
  "/offline-queue.js",
  "/rep/menu.js",
  "/rep/rep-home.js",
  "/rep/rep-dashboard.js",
  "/rep/script.js",
  "/rep/scheduler.js",
  "/rep/chat.js",
  "/rep/rep-log.html",
  "/rep/rep-log.js",
  "/admin-tracking.html",
  "/admin-tracking.js",
  "/rep/index-login.js",
  "/manifest.json",
  "/assets/favicon-192.png",
  "/assets/favicon-512.png",
  "/assets/swash-logo.png",
  "/assets/Cal-icon.png",
  "/assets/Chat-icon.png",
  "/assets/Policy-icon.png",
  "/assets/Commission-icon.png",
  "/assets/Sick-icon.png",
  "/assets/Map-icon.png",
  "/assets/Feedback-icon.png",
  "/assets/Targets-icon.png",
  "/assets/competitions-icon.png",
  "/assets/Training-icon.png",
  "/assets/logs-icon.png"
];

// install cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache each URL individually and silently skip failures
      return Promise.all(
        OFFLINE_URLS.map((url) =>
          fetch(url)
            .then((response) => {
              if (response.ok) {
                return cache.put(url, response);
              }
            })
            .catch(() => {
              // Silently skip URLs that fail to fetch
              console.debug(`[SW] Skipped caching ${url}`);
            })
        )
      );
    })
  );
  self.skipWaiting();
});

// activate and clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    self.clients.claim();
    // Notify all clients to reload to pick up fresh assets
    const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
    clientsList.forEach(c => c.postMessage({ type: 'SW_UPDATED', cache: CACHE_NAME }));
  })());
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
  if (event.tag === "sync-rep-logs") {
    event.waitUntil(syncRepLogs());
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

async function syncRepLogs() {
  try {
    const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
    clientsList.forEach((client) => client.postMessage({ type: "SYNC_REP_LOGS" }));
  } catch (err) {
    console.error("Rep logs sync failed:", err);
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
    // Try exact match first, then ignore query params (helps for routes like /rep/quote-embed.html?embed=true)
    let cached = await caches.match(request);
    if (!cached) {
      cached = await caches.match(request, { ignoreSearch: true });
    }
    if (cached) return cached;
    return caches.match("index.html");
  }
}

async function cacheFirst(request) {
  // For JS and HTML assets always fetch fresh (avoid stale code after deploy)
  const url = request.url;
  const isCode = url.endsWith('.js') || url.endsWith('.mjs') || url.endsWith('.html');
  if (isCode) {
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (e) {
      // fallback to any cached variant (ignore search helps when we added version param)
      const cached = await caches.match(request) || await caches.match(request, { ignoreSearch: true });
      return cached || Response.error();
    }
  }

  let cached = await caches.match(request);
  if (!cached) {
    cached = await caches.match(request, { ignoreSearch: true });
  }
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
