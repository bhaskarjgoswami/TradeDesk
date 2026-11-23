// Guards for files that only fail in production: Vercel routing, the service worker and trade paging.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchAllTrades } from "./tradePages.js";
import { registerServiceWorker } from "./registerServiceWorker.js";

const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");
const vercel = JSON.parse(read("../../vercel.json"));
const sw = read("../../public/sw.js");
const sync = read("../../scripts/sync-journal-ui.mjs");
const journalAssets = JSON.parse(sync.match(/const ASSETS = (\[[^\]]+\])/s)[1].replace(/\n\s*/g, ""));
const vercelRegex = source => new RegExp("^" + source.replace(/:(\w+)/g, "[^/]+") + "$");

test("SPA catch-all never rewrites hashed assets to HTML", () => {
  const catchAll = vercel.rewrites.at(-1);
  assert.equal(catchAll.destination, "/index.html");
  const re = vercelRegex(catchAll.source);
  assert.ok(re.test("/pricing") && re.test("/legal/privacy"));
  assert.ok(!re.test("/assets/index-abc123.js"));
});

test("/app routes go to the journal shell before the SPA catch-all", () => {
  const idx = p => vercel.rewrites.findIndex(r => vercelRegex(r.source).test(p));
  assert.equal(vercel.rewrites[idx("/app")].destination, "/app/index.html");
  assert.equal(vercel.rewrites[idx("/app/anything")].destination, "/app/index.html");
});

test("every journal file is revalidated by Vercel and cached for offline by the service worker", () => {
  const noCache = vercel.headers.filter(h => h.headers.some(x => x.key === "Cache-Control" && x.value === "no-cache")).map(h => vercelRegex(h.source));
  for (const file of journalAssets) {
    assert.ok(noCache.some(re => re.test("/" + file)), `${file} missing a no-cache header`);
    assert.ok(sw.includes(`'/${file}'`), `${file} missing from sw.js JOURNAL_ASSETS`);
  }
});

test("service worker never caches an HTML response as a hashed asset and prunes old ones", () => {
  assert.match(sw, /!type\.includes\("text\/html"\)/);
  assert.match(sw, /\.then\(pruneAssets\)/);
});

test("trade paging follows cursors, sorts newest first and stops on a repeated cursor", async () => {
  const pages = { "": { rows: [{ id: 3, date: "2026-11-02" }], next_cursor: 3 }, 3: { rows: [{ id: 1, date: "2026-11-05" }], next_cursor: 3 } };
  const asked = [];
  const result = await fetchAllTrades("/api/trades?symbol=BTC", async q => {
    const params = new URLSearchParams(q); asked.push(q);
    return { ok: true, json: async () => pages[params.get("before_id") || ""] };
  });
  assert.deepEqual(result.rows.map(r => r.id), [1, 3]);
  assert.equal(asked.length, 2);
  assert.ok(asked[0].includes("symbol=BTC") && asked[0].includes("limit=500"));
});

test("trade paging returns the failing page untouched", async () => {
  const bad = { ok: false, status: 401 };
  assert.equal((await fetchAllTrades("/api/trades", async () => bad)).failed, bad);
});

test("service worker registration is skipped without support and deferred until load", () => {
  assert.equal(registerServiceWorker({}, {}, {}), false);
  let registered = 0, onLoad;
  const nav = { serviceWorker: { register: () => { registered++; return Promise.resolve(); } } };
  registerServiceWorker(nav, { readyState: "loading" }, { addEventListener: (_, fn) => { onLoad = fn; } });
  assert.equal(registered, 0); onLoad(); assert.equal(registered, 1);
});
