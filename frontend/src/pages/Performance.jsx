import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmt } from "../lib/calc";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Card({ label, value, sub, cls }) {
  return (
    <div className="card">
      <div className="lbl">{label}</div>
      <div className={"val " + (cls || "")}>{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

const sign = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
const net = (t) => Number(t.pnl) - (Number(t.fee) || 0);

// Closed trades grouped by a key: count, win rate, net P&L, average R.
function groupBy(closed, keyFn) {
  const m = {};
  for (const t of closed) {
    const k = keyFn(t) || "Unassigned";
    const g = (m[k] = m[k] || { n: 0, w: 0, l: 0, net: 0, r: 0, rn: 0 });
    const v = net(t);
    g.n++; g.net += v;
    if (v > 0) g.w++; else if (v < 0) g.l++;
    if (t.r_multiple != null && t.r_multiple !== "") { g.r += Number(t.r_multiple); g.rn++; }
  }
  return Object.entries(m).sort((a, b) => b[1].net - a[1].net);
}

function GroupTable({ title, rows }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      {rows.length === 0 ? <div className="muted">No closed trades yet.</div> : (
        <table className="grp">
          <thead><tr><th></th><th className="num">Trades</th><th className="num">Win rate</th><th className="num">Avg R</th><th className="num">Net P&amp;L</th></tr></thead>
          <tbody>
            {rows.map(([k, g]) => (
              <tr key={k}>
                <td><b>{k}</b></td>
                <td className="num">{g.n}</td>
                <td className="num">{g.w + g.l ? Math.round((100 * g.w) / (g.w + g.l)) + "%" : "—"}</td>
                <td className={"num " + sign(g.r)}>{g.rn ? fmt.num(g.r / g.rn) + "R" : "—"}</td>
                <td className={"num " + sign(g.net)}>{fmt.money(g.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// What each mistake cost: trades tagged with it and their combined net P&L.
function MistakeTable({ closed }) {
  const m = {};
  for (const t of closed) for (const k of t.review?.mistakes || []) {
    m[k] = m[k] || { n: 0, net: 0 };
    m[k].n++; m[k].net += net(t);
  }
  const rows = Object.entries(m).sort((a, b) => a[1].net - b[1].net);
  return (
    <div className="panel">
      <h3>Cost of mistakes</h3>
      {rows.length === 0 ? <div className="muted">Tag mistakes in a trade's review to see what they cost you.</div> : (
        <table className="grp">
          <thead><tr><th></th><th className="num">Trades</th><th className="num">Net P&amp;L</th></tr></thead>
          <tbody>{rows.map(([k, g]) => (
            <tr key={k}><td><b>{k}</b></td><td className="num">{g.n}</td><td className={"num " + sign(g.net)}>{fmt.money(g.net)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

export default function Performance() {
  const [s, setS] = useState(null);
  const [trades, setTrades] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([api.stats(), api.listTrades()])
      .then(([st, tr]) => { setS(st); setTrades(tr); })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <main className="main"><div className="pane-pad"><div className="error">Couldn't load stats: {err}</div></div></main>;
  if (!s) return <main className="main"><div className="pane-pad"><div className="muted">Loading…</div></div></main>;

  const closed = trades
    .filter((t) => t.pnl != null && t.pnl !== "")
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id);
  let cum = 0;
  const curve = closed.map((t, i) => ({ i: i + 1, equity: Math.round((cum += net(t)) * 100) / 100, date: t.date }));
  const pf = s.profit_factor === 999 ? "∞" : s.profit_factor;
  const answered = closed.filter((t) => typeof t.review?.followed_plan === "boolean");
  const adherence = answered.length ? Math.round((100 * answered.filter((t) => t.review.followed_plan).length) / answered.length) : null;

  return (
    <main className="main">
      <div className="pane-pad">
        <h1>Performance</h1>
        <div className="stats-cards">
          <Card label="Net P&L" value={fmt.money(s.net_pnl)} sub={`Gross ${fmt.money(s.gross_pnl)} · fees ${fmt.money(s.fees)}`} cls={sign(s.net_pnl)} />
          <Card label="Win rate" value={s.closed ? s.win_rate + "%" : "—"} sub={`${s.wins}W / ${s.losses}L · ${s.closed} closed`} />
          <Card label="Expectancy" value={s.closed ? fmt.money(s.expectancy) : "—"} sub="Average net P&L per closed trade" cls={sign(s.expectancy)} />
          <Card label="Max drawdown" value={fmt.money(s.max_drawdown)} sub="Largest fall from an equity peak" cls={s.max_drawdown < 0 ? "neg" : ""} />
          <Card label="Profit factor" value={s.closed ? pf : "—"} sub="Gross wins ÷ gross losses" />
          <Card label="Avg R" value={s.avg_r + "R"} cls={sign(s.avg_r)} />
          <Card label="Avg win / loss" value={fmt.money(s.avg_win) + " / " + fmt.money(s.avg_loss)} />
          <Card label="Best / worst" value={fmt.money(s.best) + " / " + fmt.money(s.worst)} />
          <Card label="Plan adherence" value={adherence == null ? "—" : adherence + "%"} sub={`${answered.length} reviewed trade${answered.length === 1 ? "" : "s"}`} />
        </div>

        <div className="panel equity-panel">
          <h3>Equity curve · cumulative net P&L</h3>
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
                  formatter={(v) => fmt.money(v)} labelFormatter={(i) => `Trade #${i} · ${curve[i - 1]?.date || ""}`} />
                <Line type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="grp-grid">
          <GroupTable title="By setup" rows={groupBy(closed, (t) => t.setup)} />
          <GroupTable title="By symbol" rows={groupBy(closed, (t) => t.symbol)} />
          <GroupTable title="By direction" rows={groupBy(closed, (t) => t.direction)} />
          <GroupTable title="By weekday" rows={groupBy(closed, (t) => t.date && WEEKDAYS[new Date(t.date + "T12:00:00").getDay()])} />
          <GroupTable title="By plan adherence" rows={groupBy(closed, (t) => t.review?.followed_plan === true ? "Followed plan" : t.review?.followed_plan === false ? "Broke plan" : "Not reviewed")} />
          <GroupTable title="By setup quality" rows={groupBy(closed, (t) => t.review?.quality)} />
          <GroupTable title="By entry emotion" rows={groupBy(closed, (t) => t.review?.emotion_in)} />
          <MistakeTable closed={closed} />
        </div>
      </div>
    </main>
  );
}
