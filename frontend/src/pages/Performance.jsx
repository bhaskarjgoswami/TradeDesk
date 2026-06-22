import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmt } from "../lib/calc";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

function Stat({ label, value, cls }) {
  return (
    <div className="panel stat">
      <div className="label">{label}</div>
      <div className={"value " + (cls || "")}>{value}</div>
    </div>
  );
}

export default function Performance() {
  const [s, setS] = useState(null);
  const [curve, setCurve] = useState([]);

  useEffect(() => {
    api.stats().then(setS).catch(() => {});
    api.listTrades().then((trades) => {
      // build equity curve oldest→newest
      const ordered = [...trades].reverse();
      let cum = 0;
      const pts = ordered
        .filter((t) => t.pnl != null)
        .map((t, i) => {
          cum += Number(t.pnl);
          return { i: i + 1, equity: Math.round(cum * 100) / 100, date: t.date };
        });
      setCurve(pts);
    }).catch(() => {});
  }, []);

  if (!s) return <div>Loading…</div>;

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Performance</h2>
      <div className="grid stat-grid" style={{ marginBottom: 18 }}>
        <Stat label="Net P&L" value={fmt.money(s.net_pnl)} cls={s.net_pnl >= 0 ? "pos" : "neg"} />
        <Stat label="Win Rate" value={s.win_rate + "%"} />
        <Stat label="Profit Factor" value={s.profit_factor} />
        <Stat label="Avg R" value={s.avg_r} />
        <Stat label="Total Trades" value={s.total} />
        <Stat label="Wins / Losses" value={`${s.wins} / ${s.losses}`} />
        <Stat label="Avg Win" value={fmt.money(s.avg_win)} cls="pos" />
        <Stat label="Avg Loss" value={fmt.money(s.avg_loss)} cls="neg" />
        <Stat label="Best" value={fmt.money(s.best)} cls="pos" />
        <Stat label="Worst" value={fmt.money(s.worst)} cls="neg" />
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Equity Curve</h3>
        {curve.length === 0 ? (
          <div className="muted">No closed trades yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={curve}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="i" stroke="var(--muted)" />
              <YAxis stroke="var(--muted)" />
              <Tooltip
                contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8 }}
                formatter={(v) => fmt.money(v)}
                labelFormatter={(i) => `Trade #${i}`}
              />
              <Line type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}
