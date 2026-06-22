import { useState } from "react";
import { computeTrade } from "../lib/calc";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

const DIRECTIONS = ["Long", "Short"];
const OUTCOMES = ["", "Win", "Loss", "BE"];

export default function TradeModal({ initial, onClose, onSaved }) {
  const { isPro } = useAuth();
  const [t, setT] = useState(
    initial || { date: new Date().toISOString().slice(0, 10), direction: "Long" }
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setT({ ...t, [k]: e.target.value });

  // live recompute preview
  const preview = computeTrade(t);

  async function paste(e) {
    if (!isPro) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { path } = await api.uploadImage(reader.result);
        const imgs = JSON.parse(t.images || "[]");
        imgs.push(path);
        setT({ ...t, images: JSON.stringify(imgs) });
      } catch (e2) { setErr(e2.message); }
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    setBusy(true); setErr("");
    try {
      const body = computeTrade(t);
      const saved = initial?.id
        ? await api.updateTrade(initial.id, body)
        : await api.createTrade(body);
      onSaved(saved);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()} onPaste={paste}>
        <div className="header-row">
          <h2>{initial?.id ? "Edit trade" : "Add trade"}</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="row">
          <label className="field"><span>Date</span><input type="date" value={t.date || ""} onChange={set("date")} /></label>
          <label className="field"><span>Symbol</span><input value={t.symbol || ""} onChange={set("symbol")} placeholder="BTCUSD" /></label>
          <label className="field"><span>Direction</span>
            <select value={t.direction || "Long"} onChange={set("direction")}>
              {DIRECTIONS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        </div>

        <div className="row">
          <label className="field"><span>Setup</span><input value={t.setup || ""} onChange={set("setup")} /></label>
          <label className="field"><span>TF / Bias</span><input value={t.tf_bias || ""} onChange={set("tf_bias")} /></label>
        </div>

        <div className="row">
          <label className="field"><span>Entry</span><input type="number" step="any" value={t.entry ?? ""} onChange={set("entry")} /></label>
          <label className="field"><span>Stop</span><input type="number" step="any" value={t.stop ?? ""} onChange={set("stop")} /></label>
          <label className="field"><span>Exit</span><input type="number" step="any" value={t.exit ?? ""} onChange={set("exit")} /></label>
          <label className="field"><span>Qty</span><input type="number" step="any" value={t.qty ?? ""} onChange={set("qty")} /></label>
        </div>

        <div className="row">
          <label className="field"><span>Risk (auto)</span><input type="number" step="any" value={t.risk ?? preview.risk ?? ""} onChange={set("risk")} /></label>
          <label className="field"><span>P&L (auto)</span><input type="number" step="any" value={t.pnl ?? preview.pnl ?? ""} onChange={set("pnl")} /></label>
          <label className="field"><span>R-multiple (auto)</span><input type="number" step="any" value={t.r_multiple ?? preview.r_multiple ?? ""} onChange={set("r_multiple")} /></label>
          <label className="field"><span>Fee</span><input type="number" step="any" value={t.fee ?? ""} onChange={set("fee")} /></label>
        </div>

        <div className="row">
          <label className="field"><span>Outcome</span>
            <select value={t.outcome ?? preview.outcome ?? ""} onChange={set("outcome")}>
              {OUTCOMES.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
            </select>
          </label>
          <label className="field"><span>Rating (1–5)</span><input type="number" min="1" max="5" value={t.rating ?? ""} onChange={set("rating")} /></label>
          <label className="field"><span>Tags</span><input value={t.tags || ""} onChange={set("tags")} placeholder="comma,separated" /></label>
        </div>

        <label className="field"><span>Logic / thesis</span><textarea value={t.logic || ""} onChange={set("logic")} /></label>
        <label className="field"><span>Notes</span><textarea value={t.notes || ""} onChange={set("notes")} /></label>

        {isPro
          ? <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>📎 Paste a screenshot (Cmd/Ctrl+V) to attach.</div>
          : <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>🔒 Screenshot attachments are a Pro feature.</div>}

        {err && <div className="error">{err}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save trade"}</button>
        </div>
      </div>
    </div>
  );
}
