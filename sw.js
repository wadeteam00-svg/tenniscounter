/* TENNIS COUNTER — service worker
   Goal: the app opens instantly and works with no signal (e.g. on court). */

const VERSION = "tb-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// App shell: everything needed to boot with no network.
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll fails the whole install if one file 404s, so add individually.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => null)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })()
  );
});

const isBackend = (url) =>
  url.hostname.endsWith("script.google.com") ||
  url.hostname.endsWith("googleusercontent.com");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache the Google Apps Script sync backend — always live.
  if (isBackend(url)) return;

  // 1) Navigations: newest version when online, cached app when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) {
            const copy = preload.clone();
            caches.open(SHELL_CACHE).then((c) => c.put("/index.html", copy));
            return preload;
          }
          const fresh = await fetch(req);
          const copy = fresh.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("/index.html", copy));
          return fresh;
        } catch (e) {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match("/index.html")) ||
            (await cache.match("/")) ||
            new Response("離線中 · Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            })
          );
        }
      })()
    );
    return;
  }

  // 2) Same-origin assets: cache first, refresh in the background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return hit || (await network) || new Response("", { status: 504 });
      })()
    );
    return;
  }

  // 3) Third-party assets (web fonts, etc.): serve cached instantly,
  //    refresh in the background so the app still looks right offline.
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);
      return hit || (await network) || Response.error();
    })()
  );
});

// Let the page ask a waiting worker to take over immediately.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
