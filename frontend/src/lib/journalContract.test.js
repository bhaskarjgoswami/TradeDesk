// Contract: every DOM id the cloud shim reaches for must exist in the journal UI it drives.
// Catches a journal markup rename silently breaking sign-in, billing or the expiry notice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");
const shim = read("../cloud/shim.js");
const journal = ["index.html", "workspace.js", "calendar.js", "trade.js", "profile.js", "onboarding.js"].map(f => read("../../../" + f)).join("\n");

test("journal markup provides every id the cloud shim uses", () => {
  const used = new Set([...shim.matchAll(/getElementById\(["']([\w-]+)["']\)|querySelector\(["']#([\w-]+)["']\)/g)].map(m => m[1] || m[2]));
  const created = new Set([...shim.matchAll(/id=\\?["']([\w-]+)\\?["']/g)].map(m => m[1]));
  const missing = [...used].filter(id => !created.has(id) && !journal.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 10);
});
