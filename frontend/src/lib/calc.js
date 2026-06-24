// Direction-aware auto-calc of risk / pnl / r_multiple from entry/stop/exit/qty.
// Mirrors the legacy client logic so manual rows behave like Delta-pulled ones.

export function computeTrade(t) {
  const entry = num(t.entry);
  const stop = num(t.stop);
  const exit = num(t.exit);
  const qty = num(t.qty);
  const dir = t.direction === "Short" ? -1 : 1;

  const out = { ...t };

  if (entry != null && stop != null && qty != null) {
    out.risk = round(Math.abs(entry - stop) * qty);
  }
  if (entry != null && exit != null && qty != null) {
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

export const fmt = {
  money: (n) =>
    n == null || isNaN(n)
      ? "—"
      : (n < 0 ? "-" : "") +
        "$" +
        Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  num: (n, d = 2) => (n == null || n === "" || isNaN(n) ? "—" : Number(n).toFixed(d)),
};
