import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { parseCsv, importTemplate } from "../lib/csv";

// Import trades from CSV: parse locally, dry-run on the server, then import.
export default function ImportCsv({ open, onClose, onImported }) {
  const [rows, setRows] = useState(null);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { if (!open) { setRows(null); setCheck(null); setMsg(""); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  function downloadTemplate() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([importTemplate()], { type: "text/csv" }));
    a.download = "tradedesk-import-template.csv";
    a.click();
  }

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(""); setCheck(null);
    const parsed = parseCsv(await file.text());
    if (!parsed.length) { setRows(null); setMsg("No trades found in that file."); return; }
    setRows(parsed); setBusy(true);
    try { setCheck(await api.importTrades(parsed, true)); }
    catch (err) { setMsg(err.message); }
    finally { setBusy(false); }
  }

  async function run() {
    setBusy(true);
    try {
      const r = await api.importTrades(rows, false);
      onImported(r);
    } catch (err) { setMsg(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="um-overlay" onClick={onClose}>
      <div className="um-card imp-card" role="dialog" aria-modal="true" aria-label="Import trades from CSV" onClick={(e) => e.stopPropagation()}>
        <button className="um-x" type="button" onClick={onClose} title="Close">✕</button>
        <h2 className="um-title">Import trades from CSV</h2>
        <p className="um-sub">
          Required columns: <b>date</b> (YYYY-MM-DD), <b>symbol</b>, <b>direction</b> (Long/Short). P&amp;L, risk and R fill in from
          entry, stop, exit and qty when blank; <b>contract_value</b> (e.g. 0.001 for Delta BTCUSD) defaults to 1. Up to 1,000 rows.
          Identical rows are skipped on re-import.
        </p>
        <div className="imp-actions">
          <button type="button" className="btn ghost" onClick={downloadTemplate}>Download template</button>
          <label className="btn">
            Choose CSV file
            <input type="file" accept=".csv,text/csv" onChange={pick} hidden />
          </label>
        </div>

        {busy && <div className="muted">Checking…</div>}
        {msg && <div className="error">{msg}</div>}
        {check && !check.ok && (
          <div className="imp-errors">
            <b>{check.error_count} row{check.error_count > 1 ? "s" : ""} need fixing</b> (nothing was imported):
            <ul>{check.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {check?.ok && (
          <div className="imp-summary">
            <div><b>{check.to_import}</b> new trade{check.to_import === 1 ? "" : "s"} ready to import</div>
            {check.duplicates > 0 && <div className="muted">{check.duplicates} already in your journal, will be skipped</div>}
            {check.over_free_limit > 0 && (
              <div className="muted">{check.over_free_limit} exceed the Free plan's 2 trades/day and will be skipped. Pro imports everything.</div>
            )}
            <div className="um-actions">
              <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
              <button className="btn" type="button" onClick={run} disabled={busy || !check.to_import}>
                Import {check.to_import} trade{check.to_import === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
