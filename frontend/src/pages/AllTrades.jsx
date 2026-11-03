import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmt } from "../lib/calc";
import { Icon, TODAY } from "../lib/ui";
import ImportCsv from "../components/ImportCsv";
import { useFeedback } from "../lib/feedback";

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
  const [importOpen, setImportOpen] = useState(false);
  const { ask, toast } = useFeedback();
  const [notice, setNotice] = useState("");
  const now = new Date();
  const [cal, setCal] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [unit, setUnit] = useState("$"); // "$" net P&L | "R" sum of R-multiples

  async function load() {
    setLoading(true);
    try { setTrades(await api.listTrades(q ? { search: q } : {})); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const id = setTimeout(load, q ? 300 : 0); // debounce typing
    return () => clearTimeout(id);
    /* eslint-disable-next-line */
  }, [q]);

  // editing/adding happens inline in the Daily Journal, mirroring the original app
  const editInJournal = (t) => nav(`/journal?date=${encodeURIComponent(t.date || TODAY())}&edit=${t.id}`);
  const addInJournal = () => nav(`/journal?date=${encodeURIComponent(TODAY())}&edit=new`);
  const gotoDay = (ds) => nav(`/journal?date=${encodeURIComponent(ds)}`);

  function exportCsv() {
    const cols = ["date", "symbol", "direction", "setup", "entry", "stop", "exit", "qty", "pnl", "fee", "risk", "r_multiple", "outcome", "rating", "tags", "notes"];
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
      const d = (dayMap[t.date] = dayMap[t.date] || { pnl: 0, r: 0, n: 0 });
      if (t.pnl != null && t.pnl !== "") d.pnl += Number(t.pnl) - (Number(t.fee) || 0); // net of fees
      if (t.r_multiple != null && t.r_multiple !== "") d.r += Number(t.r_multiple);
      d.n++;
    }
  });
  const val = (d) => (unit === "R" ? d.r : d.pnl);
  const show = (v) => (unit === "R" ? (v > 0 ? "+" : "") + fmt.num(v) + "R" : (v > 0 ? "+" : "") + fmt.money(v));
  const days = Object.entries(dayMap);
  const maxAbs = Math.max(1e-9, ...days.map(([, d]) => Math.abs(val(d))));
  const month = {
    total: days.reduce((a, [, d]) => a + val(d), 0),
    trades: days.reduce((a, [, d]) => a + d.n, 0),
    green: days.filter(([, d]) => val(d) > 0).length,
    red: days.filter(([, d]) => val(d) < 0).length,
    best: days.length ? Math.max(...days.map(([, d]) => val(d))) : null,
    worst: days.length ? Math.min(...days.map(([, d]) => val(d))) : null,
  };
  const firstDow = new Date(cal.y, cal.m, 1).getDay();
  const daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
  const todayStr = TODAY();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${cal.y}-${String(cal.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ d, ds, info: dayMap[ds] });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    const wk = cells.slice(i, i + 7);
    const has = wk.filter((c) => c?.info);
    weeks.push({ cells: wk, total: has.reduce((a, c) => a + val(c.info), 0), n: has.reduce((a, c) => a + c.info.n, 0) });
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
            <button className="btn ghost" onClick={() => setImportOpen(true)}>Import CSV</button>
            <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
            <button className="btn" onClick={addInJournal}>+ Add trade</button>
          </div>
        </div>

        {notice && <div className="ex-note" style={{ marginBottom: 14 }}>{notice}</div>}
        <ImportCsv
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={(r) => {
            setImportOpen(false);
            setNotice(`Imported ${r.imported} trade${r.imported === 1 ? "" : "s"}.` +
              (r.duplicates ? ` Skipped ${r.duplicates} duplicate${r.duplicates === 1 ? "" : "s"}.` : "") +
              (r.over_free_limit ? ` Skipped ${r.over_free_limit} over the Free daily limit.` : ""));
            load();
          }}
        />
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
                              onClick={async () => {
                                if (!(await ask({ title: "Delete this trade?", body: `${t.symbol || "Trade"} on ${t.date || "—"} will be removed permanently.`, confirmLabel: "Delete", danger: true }))) return;
                                await api.deleteTrade(t.id); toast("Trade deleted"); load();
                              }}>Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 650 }}>{MON[cal.m]} {cal.y}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="viewseg" role="group" aria-label="Calendar unit">
                  <button className={unit === "$" ? "on" : ""} onClick={() => setUnit("$")}>P&amp;L</button>
                  <button className={unit === "R" ? "on" : ""} onClick={() => setUnit("R")}>R</button>
                </div>
                <button className="icobtn" onClick={prevMonth} aria-label="Previous month">‹</button>
                <button className="btn ghost" onClick={() => setCal({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
                <button className="icobtn" onClick={nextMonth} aria-label="Next month">›</button>
              </div>
            </div>

            <div className="cal-sum">
              <div><span>Month {unit === "R" ? "R" : "net"}</span><b className={pnlCls(month.total)}>{days.length ? show(month.total) : "—"}</b></div>
              <div><span>Trading days</span><b>{days.length} · {month.trades} trade{month.trades === 1 ? "" : "s"}</b></div>
              <div><span>Green / red days</span><b><span className="pos">{month.green}</span> / <span className="neg">{month.red}</span></b></div>
              <div><span>Best day</span><b className={pnlCls(month.best)}>{month.best == null ? "—" : show(month.best)}</b></div>
              <div><span>Worst day</span><b className={pnlCls(month.worst)}>{month.worst == null ? "—" : show(month.worst)}</b></div>
            </div>

            <div className="panel">
              <div className="cal-head cal-8">{DOW.map((d) => <div key={d}>{d}</div>)}<div>Week</div></div>
              <div className="cal-grid cal-8">
                {weeks.map((w, wi) => [
                  ...w.cells.map((c, i) => {
                    if (!c) return <div className="cell blank" key={`b${wi}-${i}`} />;
                    const info = c.info;
                    let cls = "cell";
                    let style;
                    if (info) {
                      const v = val(info);
                      cls += v > 0 ? " has win" : v < 0 ? " has loss" : " has";
                      style = { "--i": (0.12 + 0.45 * Math.abs(v) / maxAbs).toFixed(2) };
                    }
                    if (c.ds === todayStr) cls += " today";
                    return (
                      <div className={cls} key={c.ds} style={style} onClick={info ? () => gotoDay(c.ds) : undefined}
                           role={info ? "button" : undefined} tabIndex={info ? 0 : undefined}
                           onKeyDown={info ? (e) => e.key === "Enter" && gotoDay(c.ds) : undefined}>
                        <div className="d">{c.d}</div>
                        {info && <>
                          <div className="cpnl">{show(val(info))}</div>
                          <div className="ct">{info.n} trade{info.n > 1 ? "s" : ""}</div>
                        </>}
                      </div>
                    );
                  }),
                  <div className="cell wk" key={`w${wi}`}>
                    <div className="d">W{wi + 1}</div>
                    {w.n > 0 && <>
                      <div className={"cpnl " + pnlCls(w.total)}>{show(w.total)}</div>
                      <div className="ct">{w.n} trade{w.n > 1 ? "s" : ""}</div>
                    </>}
                  </div>,
                ])}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
