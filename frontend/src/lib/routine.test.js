import { test } from "node:test";
import assert from "node:assert/strict";
import { routineDay, doneToday, normalizeRoutine, safeLink, MAX_STEPS } from "./routine.js";

test("routine day honours the reset time", () => {
  const early = new Date(2026, 10, 3, 5, 30);
  assert.equal(routineDay("06:00", early), "2026-11-02");
  assert.equal(routineDay("00:00", early), "2026-11-03");
  assert.equal(routineDay("06:00", new Date(2026, 10, 3, 6, 0)), "2026-11-03");
});

test("progress from another day, or for removed steps, doesn't count", () => {
  const r = normalizeRoutine({ steps: [{ title: "A" }, { title: "B" }] });
  const now = new Date(2026, 10, 3, 9, 0);
  assert.deepEqual(doneToday({ day: "2026-11-03", done: ["A", "Gone"] }, r, now), ["A"]);
  assert.deepEqual(doneToday({ day: "2026-11-02", done: ["A"] }, r, now), []);
});

test("normalize caps steps, drops blanks and unsafe links", () => {
  const r = normalizeRoutine({ resetTime: "bad", steps: [...Array(9)].map((_, i) => ({ title: i ? `S${i}` : " ", link: "javascript:alert(1)" })) });
  assert.equal(r.steps.length, MAX_STEPS);
  assert.equal(r.resetTime, "00:00");
  assert.ok(r.steps.every((s) => s.link === ""));
  assert.equal(safeLink("forexfactory.com/calendar"), "https://forexfactory.com/calendar");
});
