// TradeDesk service worker: installable app + offline shell. Deliberately
// conservative so a deploy is never hidden behind a stale cache.
//  - page loads: network first, cached shell only when offline
//  - /assets/* (content-hashed): cache first
//  - everything else (API, Supabase, other origins): not intercepted
const CACHE = "tradedesk-v3";
const SHELL = "/index.html";

const JOURNAL_ASSETS=['/cloud-boot.js','/language.js','/onboarding.js','/feedback-page.js','/trade-drafts.js','/broker-import.js','/workspace.js','/calendar.js','/trade.js','/playbook.js','/profile.js','/meditation.js','/workspace.css','/theme.css','/theme-mercury.css'];
self.addEventListener("install",(event)=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll([SHELL,'/app/index.html',...JOURNAL_ASSETS]);
    const response=await fetch('/app/index.html');
    if(response.ok){const html=await response.text();const assets=Array.from(html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g),match=>match[1]);if(assets.length)await cache.addAll([...new Set(assets)]);}
    await self.skipWaiting();
  })());
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
  if (/^\/locales\/(en|hi|es|fr|de|pt|ar|zh-CN)\.json$/.test(url.pathname) || /^\/(cloud-boot|language|onboarding|feedback-page|trade-drafts|broker-import|workspace|calendar|trade|playbook|profile|meditation)\.js$|^\/(workspace|theme|theme-mercury)\.css$/.test(url.pathname)) {
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
