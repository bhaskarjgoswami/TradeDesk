import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmt } from "../lib/calc";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

function Card({ label, value, cls }) {
  return (
    <div className="card">
      <div className="lbl">{label}</div>
      <div className={"val " + (cls || "")}>{value}</div>
    </div>
  );
}

export default function Performance() {
  const [s, setS] = useState(null);
  const [curve, setCurve] = useState([]);
  const [bySetup, setBySetup] = useState([]);

  useEffect(() => {
    api.stats().then(setS).catch(() => {});
    api.listTrades().then((trades) => {
      const ordered = [...trades].reverse();
      let cum = 0;
      setCurve(ordered.filter((t) => t.pnl != null).map((t, i) => {
        cum += Number(t.pnl);
        return { i: i + 1, equity: Math.round(cum * 100) / 100, date: t.date };
      }));
      const m = {};
      trades.forEach((t) => {
        const k = t.setup || "—";
        m[k] = m[k] || { n: 0, w: 0, pnl: 0 };
        m[k].n++; if (t.outcome === "Win") m[k].w++; m[k].pnl += Number(t.pnl) || 0;
      });
      setBySetup(Object.entries(m).sort((a, b) => b[1].pnl - a[1].pnl));
    }).catch(() => {});
  }, []);

  if (!s) return <main className="main"><div className="pane-pad"><div className="muted">Loading…</div></div></main>;
  const pf = s.profit_factor === 999 ? "∞" : s.profit_factor;

  return (
    <main className="main">
      <div className="pane-pad">
        <h1>Performance</h1>
        <div className="stats-cards">
          <Card label="Trades" value={s.total} />
          <Card label="Win rate" value={s.win_rate + "%"} />
          <Card label="Net P&L" value={fmt.money(s.net_pnl)} cls={s.net_pnl > 0 ? "pos" : s.net_pnl < 0 ? "neg" : ""} />
          <Card label="Profit factor" value={pf} />
          <Card label="Avg R" value={s.avg_r + "R"} cls={s.avg_r > 0 ? "pos" : s.avg_r < 0 ? "neg" : ""} />
          <Card label="Avg win" value={fmt.money(s.avg_win)} cls="pos" />
          <Card label="Avg loss" value={fmt.money(s.avg_loss)} cls="neg" />
          <Card label="Best / worst" value={fmt.money(s.best) + " / " + fmt.money(s.worst)} />
        </div>

        <div className="panel equity-panel">
          <h3>Equity curve · cumulative P&L</h3>
          {curve.length === 0 ? (
            <div className="muted">Add trades with P&L to see your equity curve.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={curve}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="i" stroke="var(--mut)" />
                <YAxis stroke="var(--mut)" />
                <Tooltip
                  contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--txt)" }}
                  formatter={(v) => fmt.money(v)} labelFormatter={(i) => `Trade #${i}`} />
                <Line type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel">
          <h3>By setup</h3>
          {bySetup.length === 0 ? <div className="muted">No data yet.</div> : bySetup.map(([k, v]) => {
            const wr = v.n ? Math.round((100 * v.w) / v.n) : 0;
            return (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <div><b>{k}</b> <span className="muted" style={{ fontSize: 12 }}>· {v.n} trades · {wr}% win</span></div>
                <div className={"num " + (v.pnl > 0 ? "pos" : v.pnl < 0 ? "neg" : "muted")} style={{ fontWeight: 650 }}>{fmt.money(v.pnl)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
