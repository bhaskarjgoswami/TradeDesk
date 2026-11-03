// Direction-aware auto-calc of risk / pnl / r_multiple from entry/stop/exit/qty.
// Mirrors the legacy client logic so manual rows behave like Delta-pulled ones.

export function computeTrade(t) {
  const entry = num(t.entry);
  const stop = num(t.stop);
  const exit = num(t.exit);
  const qty = num(t.qty);
  const dir = t.direction === "Short" ? -1 : 1;

  const out = { ...t };
  // Coerce all numeric fields to number-or-null so empty inputs ("") don't
  // reach the API as strings — Pydantic rejects "" for float/int with a 422.
  out.entry = entry;
  out.stop = stop;
  out.exit = exit;
  out.qty = qty;
  out.risk = num(t.risk);
  out.pnl = num(t.pnl);
  out.r_multiple = num(t.r_multiple);
  out.fee = num(t.fee);
  out.rating = t.rating === "" || t.rating == null ? null : Math.trunc(Number(t.rating)) || null;

  // Only fill risk / P&L when blank. A typed value or an exchange-imported one
  // (which accounts for contract size, e.g. 0.001 BTC per Delta lot) wins.
  if (out.risk == null && entry != null && stop != null && qty != null) {
    out.risk = round(Math.abs(entry - stop) * qty);
  }
  if (out.pnl == null && entry != null && exit != null && qty != null) {
    out.pnl = round((exit - entry) * dir * qty);
  }
  if (entry != null && stop != null && exit != null) {
    const r = Math.abs(entry - stop);
    if (r > 0) out.r_multiple = round(((exit - entry) * dir) / r, 2);
  }
  if (out.pnl != null && !t.outcome) {
    out.outcome = out.pnl > 0 ? "Win" : out.pnl < 0 ? "Loss" : "BE";
  }
  return out;
}

function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// Journal currency is a display label only (no conversion). Set from user prefs.
const CURRENCIES = { USD: { sym: "$", loc: "en-US" }, INR: { sym: "₹", loc: "en-IN" } };
let cur = CURRENCIES.USD;
export function setCurrency(code) { cur = CURRENCIES[code] || CURRENCIES.USD; }

export const fmt = {
  money: (n) =>
    n == null || isNaN(n)
      ? "—"
      : (n < 0 ? "-" : "") +
        cur.sym +
        Math.abs(Number(n)).toLocaleString(cur.loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  num: (n, d = 2) => (n == null || n === "" || isNaN(n) ? "—" : Number(n).toFixed(d)),
};
