// Minify the journal UI copies in dist/ after `vite build`. The repo-root sources stay readable;
// only the deployed files shrink. Identifiers are kept because the classic scripts share globals.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const FILES = ["language.js", "onboarding.js", "feedback-page.js", "trade-drafts.js", "broker-import.js", "workspace.js", "calendar.js", "trade.js", "playbook.js", "profile.js", "meditation.js", "news.js",
               "workspace.css", "theme.css", "theme-mercury.css"];
let before = 0, after = 0;
for (const f of FILES) {
  const path = join(dist, f), src = readFileSync(path, "utf8");
  const { code } = await transform(src, { loader: f.endsWith(".css") ? "css" : "js", minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, target: "es2020", legalComments: "none" });
  writeFileSync(path, code);
  before += src.length; after += code.length;
}
console.log(`minified journal UI: ${(before / 1024).toFixed(0)} kB -> ${(after / 1024).toFixed(0)} kB`);
