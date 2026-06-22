import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmt } from "../lib/calc";
import TradeModal from "../components/TradeModal";

export default function AllTrades() {
  const [trades, setTrades] = useState([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setTrades(await api.listTrades(search ? { search } : {}));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function del(id) {
    if (!confirm("Delete this trade?")) return;
    await api.deleteTrade(id);
    load();
  }

  function exportCsv() {
    const cols = ["date", "symbol", "direction", "setup", "entry", "stop", "exit", "qty", "risk", "pnl", "r_multiple", "outcome", "rating", "tags"];
    const head = cols.join(",");
    const rows = trades.map((t) => cols.map((c) => `"${(t[c] ?? "").toString().replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([head + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tradedesk_trades.csv";
    a.click();
  }

  return (
    <>
      <div className="header-row">
        <h2>All Trades <span className="muted">({trades.length})</span></h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && load()} style={{ width: 200 }} />
          <button onClick={load}>Search</button>
          <button onClick={exportCsv}>Export CSV</button>
          <button className="primary" onClick={() => setAdding(true)}>+ Add</button>
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Symbol</th><th>Dir</th><th>Setup</th>
              <th>Entry</th><th>Exit</th><th>P&L</th><th>R</th><th>Outcome</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={10}>Loading…</td></tr>
              : trades.length === 0 ? <tr><td colSpan={10} className="muted">No trades yet. Add your first one →</td></tr>
              : trades.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.symbol}</td>
                  <td><span className="pill">{t.direction}</span></td>
                  <td>{t.setup}</td>
                  <td>{fmt.num(t.entry)}</td>
                  <td>{fmt.num(t.exit)}</td>
                  <td className={t.pnl > 0 ? "pos" : t.pnl < 0 ? "neg" : ""}>{fmt.money(t.pnl)}</td>
                  <td className={t.r_multiple > 0 ? "pos" : t.r_multiple < 0 ? "neg" : ""}>{fmt.num(t.r_multiple, 2)}</td>
                  <td>{t.outcome}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button onClick={() => setEditing(t)} style={{ padding: "4px 8px" }}>Edit</button>{" "}
                    <button className="danger" onClick={() => del(t.id)} style={{ padding: "4px 8px" }}>Del</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {adding && <TradeModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {editing && <TradeModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}
