/* Service worker for the Family Command Centre.

   The one rule that matters here: /api is never cached. A family calendar
   that shows yesterday's dinner time is worse than one that says it cannot
   reach the server, so API requests go to the network and fail honestly.

   Everything else is safe to cache because Vite content-hashes it: a built
   file at /assets/index-ABC123.js can never change its contents, so once it
   is in the cache it is correct forever. index.html is the exception - it is
   the one file whose contents change on every deploy, so it is fetched from
   the network first and only served from the cache when offline. */

const VERSION = "fcc-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const KEEP = [SHELL, ASSETS];

/* The page's own CSS and JS are requested before this worker controls the
   page, so on a first visit they would never reach the cache and the app
   would be blank offline until the second visit. Instead, install reads
   index.html and precaches exactly the files that build references - no
   generated asset list to drift out of step with the build. */
async function precache() {
  const shell = await caches.open(SHELL);
  const res = await fetch("/", { cache: "no-store" });
  const html = await res.clone().text();
  await shell.put("/", res);
  await shell.addAll(["/manifest.webmanifest", "/icon-192.png"]).catch(() => {});

  const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (refs.length) {
    const assets = await caches.open(ASSETS);
    await assets.addAll([...new Set(refs)]).catch(() => {});
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

/* A reminder arrives from the server as { title, body, url, tag }. The tag
   means a repeat of the same reminder replaces the old one rather than
   stacking up. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "Family Command Centre", {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

/* Tapping a reminder brings the app forward if it is already open, and
   opens it if not. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      /* Already open: tell the app which item, rather than navigating -
         iPhone does not support navigate() from here. */
      if (open) { open.postMessage({ type: "open-item", url }); return open.focus(); }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;          // never cached - see above

  // Navigations: network first, cached shell only when the network is gone.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error()))
    );
    return;
  }

  // Hashed build output and icons: cache first, they cannot go stale.
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(ASSETS).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});