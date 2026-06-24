import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmt } from "../lib/calc";
import { Icon, TODAY } from "../lib/ui";

function pnlCls(n) { return n > 0 ? "pos" : n < 0 ? "neg" : ""; }
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AllTrades() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const q = params.get("q") || "";
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | calendar
  const now = new Date();
  const [cal, setCal] = useState({ y: now.getFullYear(), m: now.getMonth() });

  async function load() {
    setLoading(true);
    try { setTrades(await api.listTrades(q ? { search: q } : {})); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q]);

  // editing/adding happens inline in the Daily Journal, mirroring the original app
  const editInJournal = (t) => nav(`/journal?date=${encodeURIComponent(t.date || TODAY())}&edit=${t.id}`);
  const addInJournal = () => nav(`/journal?date=${encodeURIComponent(TODAY())}&edit=new`);
  const gotoDay = (ds) => nav(`/journal?date=${encodeURIComponent(ds)}`);

  function exportCsv() {
    const cols = ["date", "symbol", "direction", "setup", "entry", "stop", "exit", "qty", "risk", "pnl", "r_multiple", "outcome", "rating", "tags"];
    const rows = trades.map((t) => cols.map((c) => `"${(t[c] ?? "").toString().replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([cols.join(",") + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "trade-journal.csv";
    a.click();
  }

  function prevMonth() { setCal((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })); }
  function nextMonth() { setCal((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })); }

  // build per-day P&L map for the visible month
  const dayMap = {};
  trades.forEach((t) => {
    if (!t.date) return;
    const [ty, tm] = t.date.split("-").map(Number);
    if (ty === cal.y && tm === cal.m + 1) {
      const d = (dayMap[t.date] = dayMap[t.date] || { pnl: 0, n: 0 });
      d.pnl += Number(t.pnl) || 0; d.n++;
    }
  });
  const maxAbs = Math.max(1, ...Object.values(dayMap).map((d) => Math.abs(d.pnl)));
  const firstDow = new Date(cal.y, cal.m, 1).getDay();
  const daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
  const todayStr = TODAY();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${cal.y}-${String(cal.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ d, ds, info: dayMap[ds] });
  }

  return (
    <main className="main">
      <div className="pane-pad">
        <div className="pane-head">
          <h1>All Trades <span className="muted" style={{ fontWeight: 400 }}>({trades.length})</span></h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="viewseg">
              <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
              <button className={view === "calendar" ? "on" : ""} onClick={() => setView("calendar")}>Calendar</button>
            </div>
            {view === "list" && (
              <div className="searchbox">{Icon.search}
                <input placeholder="Search…" value={q} onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {})} />
              </div>
            )}
            <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
            <button className="btn" onClick={addInJournal}>+ Add trade</button>
          </div>
        </div>

        {view === "list" ? (
          <div className="tablewrap">
            <table>
              <thead><tr>
                <th>Date</th><th>Symbol</th><th>Dir</th><th>Setup</th>
                <th className="num">Entry</th><th className="num">Exit</th><th className="num">R</th>
                <th className="num">P&amp;L</th><th>Result</th><th></th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="muted" style={{ padding: 28, textAlign: "center" }}>Loading…</td></tr>
                ) : trades.length === 0 ? (
                  <tr><td colSpan={10} className="muted" style={{ padding: 28, textAlign: "center" }}>No trades yet.</td></tr>
                ) : trades.map((t) => (
                  <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => editInJournal(t)}>
                    <td className="num muted">{t.date || "—"}</td>
                    <td><b>{t.symbol || "—"}</b></td>
                    <td>{t.direction ? <span className={"pill " + t.direction.toLowerCase()}>{t.direction}</span> : "—"}</td>
                    <td>{t.setup ? <span className="pill setup">{t.setup}</span> : "—"}</td>
                    <td className="num">{fmt.num(t.entry)}</td>
                    <td className="num">{fmt.num(t.exit)}</td>
                    <td className={"num " + pnlCls(t.r_multiple)}>{t.r_multiple == null || t.r_multiple === "" ? "—" : fmt.num(t.r_multiple, 2) + "R"}</td>
                    <td className={"num " + pnlCls(t.pnl)}>{fmt.money(t.pnl)}</td>
                    <td>{t.outcome ? <span className={"pill " + t.outcome.toLowerCase()}>{t.outcome}</span> : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn danger" style={{ padding: "5px 10px" }}
                              onClick={async () => { if (confirm("Delete this trade?")) { await api.deleteTrade(t.id); load(); } }}>Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 650 }}>{MON[cal.m]} {cal.y}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="icobtn" onClick={prevMonth}>‹</button>
                <button className="btn ghost" onClick={() => setCal({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
                <button className="icobtn" onClick={nextMonth}>›</button>
              </div>
            </div>
            <div className="panel">
              <div className="cal-head">{DOW.map((d) => <div key={d}>{d}</div>)}</div>
              <div className="cal-grid">
                {cells.map((c, i) => {
                  if (!c) return <div className="cell blank" key={"b" + i} />;
                  const info = c.info;
                  let cls = "cell";
                  let style;
                  if (info) {
                    cls += info.pnl > 0 ? " has win" : info.pnl < 0 ? " has loss" : " has";
                    style = { "--i": (0.12 + 0.45 * Math.abs(info.pnl) / maxAbs).toFixed(2) };
                  }
                  if (c.ds === todayStr) cls += " today";
                  return (
                    <div className={cls} key={c.ds} style={style} onClick={info ? () => gotoDay(c.ds) : undefined}>
                      <div className="d">{c.d}</div>
                      {info && <>
                        <div className="cpnl">{info.pnl > 0 ? "+" : ""}{fmt.money(info.pnl)}</div>
                        <div className="ct">{info.n} trade{info.n > 1 ? "s" : ""}</div>
                      </>}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
