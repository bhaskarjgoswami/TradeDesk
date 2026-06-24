import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { fmt } from "../lib/calc";
import { Icon } from "../lib/ui";
import TradeModal from "../components/TradeModal";

function pnlCls(n) { return n > 0 ? "pos" : n < 0 ? "neg" : ""; }

export default function AllTrades() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const [trades, setTrades] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setTrades(await api.listTrades(q ? { search: q } : {})); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q]);

  function exportCsv() {
    const cols = ["date", "symbol", "direction", "setup", "entry", "stop", "exit", "qty", "risk", "pnl", "r_multiple", "outcome", "rating", "tags"];
    const rows = trades.map((t) => cols.map((c) => `"${(t[c] ?? "").toString().replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([cols.join(",") + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "trade-journal.csv";
    a.click();
  }

  return (
    <main className="main">
      <div className="pane-pad">
        <div className="pane-head">
          <h1>All Trades <span className="muted" style={{ fontWeight: 400 }}>({trades.length})</span></h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="searchbox">{Icon.search}
              <input placeholder="Search…" value={q} onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {})} />
            </div>
            <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
            <button className="btn" onClick={() => setAdding(true)}>+ Add trade</button>
          </div>
        </div>

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
                <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setEditing(t)}>
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
      </div>

      {adding && <TradeModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {editing && <TradeModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </main>
  );
}
