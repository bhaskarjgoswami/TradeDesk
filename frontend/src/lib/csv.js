// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF.
// Returns objects keyed by lowercased header names.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const data = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!data.length) return [];
  const head = data[0].map((h) => h.trim().toLowerCase());
  return data.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export const IMPORT_COLUMNS = [
  "date", "symbol", "direction", "setup", "entry", "stop", "exit", "qty",
  "pnl", "fee", "risk", "r_multiple", "contract_value", "tags", "notes",
];

export function importTemplate() {
  return IMPORT_COLUMNS.join(",") + "\n" +
    "2026-11-03,BTCUSD,Long,QML,70000,69800,70400,10,,0.2,,,0.001,breakout,Example row - delete me\n";
}
