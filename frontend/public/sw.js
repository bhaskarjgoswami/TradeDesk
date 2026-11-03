// TradeDesk service worker: installable app + offline shell. Deliberately
// conservative so a deploy is never hidden behind a stale cache.
//  - page loads: network first, cached shell only when offline
//  - /assets/* (content-hashed): cache first
//  - everything else (API, Supabase, other origins): not intercepted
const CACHE = "tradedesk-v2";
const SHELL = "/index.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SHELL, "/app/index.html"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // two app shells: the journal at /app, the React site everywhere else
    const shell = url.pathname === "/app" || url.pathname.startsWith("/app/") ? "/app/index.html" : SHELL;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(shell, copy)); }
          return res;
        })
        .catch(() => caches.match(shell))
    );
    return;
  }

  // journal UI scripts/styles are not content-hashed: network first, cache for offline
  if (/^\/(workspace|calendar|trade|playbook|profile|meditation)\.js$|^\/(workspace|theme|theme-mercury)\.css$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
