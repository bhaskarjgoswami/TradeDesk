import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmt } from "../lib/calc";
import { useAuth } from "../lib/AuthContext";
import TradeModal from "../components/TradeModal";

const SECTIONS = [
  { key: "market", label: "1 · Pre-Market — Market Context" },
  { key: "watchlist", label: "Watchlist" },
  { key: "mistakes", label: "2 · Daily Recap — Mistakes" },
  { key: "did_great", label: "What I Did Great" },
  { key: "reinforcement", label: "Reinforcement" },
  { key: "overall", label: "3 · Overall" },
];

export default function DailyJournal() {
  const { isPro } = useAuth();
  const [days, setDays] = useState([]);
  const [active, setActive] = useState(null); // date string
  const [detail, setDetail] = useState(null);
  const [log, setLog] = useState({});
  const [saveState, setSaveState] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pullMsg, setPullMsg] = useState("");

  async function loadDays() {
    const d = await api.listDaylogs();
    setDays(d);
    if (!active && d.length) selectDay(d[0].date);
    else if (!active) {
      const today = new Date().toISOString().slice(0, 10);
      selectDay(today);
    }
  }
  useEffect(() => { loadDays(); /* eslint-disable-next-line */ }, []);

  async function selectDay(date) {
    setActive(date);
    const d = await api.getDaylog(date);
    setDetail(d);
    setLog(d.log || {});
  }

  // debounced autosave
  useEffect(() => {
    if (!active) return;
    setSaveState("saving");
    const id = setTimeout(async () => {
      try {
        await api.saveDaylog({ date: active, ...log });
        setSaveState("saved");
        loadDays();
      } catch { setSaveState("error"); }
    }, 800);
    return () => clearTimeout(id);
    /* eslint-disable-next-line */
  }, [log]);

  async function pullDelta() {
    setPullMsg("Pulling…");
    try {
      const { trades } = await api.deltaToday();
      let n = 0;
      for (const t of trades.filter((x) => !x.open)) {
        await api.createTrade(t);
        n++;
      }
      setPullMsg(`Imported ${n} round-trip trade(s).`);
      selectDay(active);
      loadDays();
    } catch (e) {
      setPullMsg(e.message);
    }
  }

  return (
    <div style={{ display: "flex", gap: 18, height: "100%" }}>
      {/* days list */}
      <div style={{ width: 240, flexShrink: 0, overflowY: "auto" }}>
        <div className="header-row"><h2 style={{ fontSize: 18 }}>Days</h2></div>
        {days.map((d) => (
          <div key={d.date} className="panel" style={{ padding: 12, marginBottom: 8, cursor: "pointer",
                 borderColor: d.date === active ? "var(--accent)" : "var(--border)" }}
               onClick={() => selectDay(d.date)}>
            <div style={{ fontWeight: 600 }}>{d.date}</div>
            <div className={d.net_pnl >= 0 ? "pos" : "neg"}>{fmt.money(d.net_pnl)}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {d.total_trades} trade(s){!d.has_log && " · no log"}
            </div>
          </div>
        ))}
      </div>

      {/* day detail */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!detail ? <div>Loading…</div> : (
          <>
            <div className="header-row">
              <h2 style={{ margin: 0 }}>{active}
                <span className="muted" style={{ fontSize: 13, marginLeft: 10 }}>
                  {saveState === "saving" ? "saving…" : saveState === "saved" ? "✓ saved" : saveState === "error" ? "save failed" : ""}
                </span>
              </h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="primary" onClick={() => setAdding(true)}>+ Add trade</button>
                <button onClick={pullDelta} disabled={!isPro} title={isPro ? "" : "Pro feature"}>
                  {isPro ? "⬇ Pull from Delta" : "🔒 Pull from Delta"}
                </button>
              </div>
            </div>
            {pullMsg && <div className="muted" style={{ marginBottom: 10 }}>{pullMsg}</div>}

            {/* day stats */}
            <div className="grid stat-grid" style={{ marginBottom: 16 }}>
              <Stat label="Net P&L" value={fmt.money(detail.stats.net_pnl)} cls={detail.stats.net_pnl >= 0 ? "pos" : "neg"} />
              <Stat label="Gross" value={fmt.money(detail.stats.gross_pnl)} />
              <Stat label="Fees" value={fmt.money(detail.stats.platform_fee)} />
              <Stat label="PF" value={detail.stats.profit_factor} />
              <Stat label="Win Rate" value={detail.stats.winrate + "%"} />
              <Stat label="W / L" value={`${detail.stats.winners} / ${detail.stats.losers}`} />
            </div>

            {/* trades */}
            <div className="panel" style={{ padding: 0, marginBottom: 16, overflowX: "auto" }}>
              <table>
                <thead><tr><th>Symbol</th><th>Dir</th><th>Entry</th><th>Exit</th><th>P&L</th><th>R</th><th></th></tr></thead>
                <tbody>
                  {detail.trades.length === 0 ? <tr><td colSpan={7} className="muted">No trades this day.</td></tr>
                    : detail.trades.map((t) => (
                      <tr key={t.id}>
                        <td>{t.symbol}</td><td>{t.direction}</td>
                        <td>{fmt.num(t.entry)}</td><td>{fmt.num(t.exit)}</td>
                        <td className={t.pnl > 0 ? "pos" : t.pnl < 0 ? "neg" : ""}>{fmt.money(t.pnl)}</td>
                        <td>{fmt.num(t.r_multiple, 2)}</td>
                        <td><button onClick={() => setEditing(t)} style={{ padding: "4px 8px" }}>Edit</button></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {/* journal sections */}
            <div className="panel">
              {SECTIONS.map((sec) => (
                <label className="field" key={sec.key}>
                  <span>{sec.label}</span>
                  <textarea value={log[sec.key] || ""} onChange={(e) => setLog({ ...log, [sec.key]: e.target.value })} />
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {adding && <TradeModal initial={{ date: active, direction: "Long" }} onClose={() => setAdding(false)}
                             onSaved={() => { setAdding(false); selectDay(active); loadDays(); }} />}
      {editing && <TradeModal initial={editing} onClose={() => setEditing(null)}
                              onSaved={() => { setEditing(null); selectDay(active); loadDays(); }} />}
    </div>
  );
}

function Stat({ label, value, cls }) {
  return (
    <div className="panel stat">
      <div className="label">{label}</div>
      <div className={"value " + (cls || "")} style={{ fontSize: 18 }}>{value}</div>
    </div>
  );
}
