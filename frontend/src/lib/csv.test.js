import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, importTemplate, IMPORT_COLUMNS } from "./csv.js";

test("parses quotes, escaped quotes, CRLF and blank lines", () => {
  const rows = parseCsv('﻿Date,Symbol,Notes\r\n2026-11-03,BTCUSD,"said ""hi"", then left"\r\n\r\n2026-11-04,ETHUSD,"multi\nline"\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { date: "2026-11-03", symbol: "BTCUSD", notes: 'said "hi", then left' });
  assert.equal(rows[1].notes, "multi\nline");
});

test("template header matches the importer columns", () => {
  const [row] = parseCsv(importTemplate());
  assert.deepEqual(Object.keys(row), IMPORT_COLUMNS);
  assert.equal(row.contract_value, "0.001");
});
