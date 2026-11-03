import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTrade, fmt, setCurrency } from "./calc.js";

test("keeps a stored / typed P&L (exchange values include contract size)", () => {
  assert.equal(computeTrade({ entry: 70000, exit: 70100, qty: 10, pnl: 1.0 }).pnl, 1.0);
});

test("computes P&L, risk and R while blank, direction-aware", () => {
  const long = computeTrade({ direction: "Long", entry: 100, stop: 95, exit: 110, qty: 2, pnl: "" });
  assert.deepEqual([long.pnl, long.risk, long.r_multiple, long.outcome], [20, 10, 2, "Win"]);
  const short = computeTrade({ direction: "Short", entry: 100, stop: 105, exit: 110, qty: 1 });
  assert.deepEqual([short.pnl, short.r_multiple, short.outcome], [-10, -2, "Loss"]);
});

test("empty numeric inputs become null, not strings", () => {
  const t = computeTrade({ entry: "", fee: "", rating: "" });
  assert.equal(t.entry, null);
  assert.equal(t.fee, null);
  assert.equal(t.rating, null);
});

test("money formatting follows the journal currency", () => {
  setCurrency("INR");
  assert.equal(fmt.money(-150000), "-₹1,50,000.00");
  setCurrency("USD");
  assert.equal(fmt.money(1234.5), "$1,234.50");
  assert.equal(fmt.money(null), "—");
});
