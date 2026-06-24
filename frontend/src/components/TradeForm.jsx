import { useEffect, useState } from "react";
import { computeTrade, fmt } from "../lib/calc";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

export default function TradeForm({ initial, onClose, onSaved }) {
  const { isPro } = useAuth();
  const [t, setT] = useState(initial || { date: new Date().toLocaleDateString("en-CA"), direction: "Long" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setT({ ...t, [k]: e.target.value });
  const preview = computeTrade(t);
  const images = (() => { try { return JSON.parse(t.images || "[]"); } catch { return []; } })();

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function paste(e) {
    if (!isPro) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { path } = await api.uploadImage(reader.result);
        setT({ ...t, images: JSON.stringify([...images, path]) });
      } catch (e2) { setErr(e2.message); }
    };
    reader.readAsDataURL(file);
  }
  function rmShot(i) {
    const next = images.slice(); next.splice(i, 1);
    setT({ ...t, images: next.length ? JSON.stringify(next) : null });
  }

  async function save() {
    setBusy(true); setErr("");
    try {
      const body = computeTrade(t);
      const saved = initial?.id ? await api.updateTrade(initial.id, body) : await api.createTrade(body);
      onSaved(saved);
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  const dir = t.direction || "";
  const out = t.outcome ?? preview.outcome ?? "";
  const rating = Number(t.rating) || 0;
  const sgn = (v) => (v == null ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "");

  return (
    <div className="tradeform" onPaste={paste}>
      <div style={{ marginBottom: 6 }}>
        <h2>{initial?.id ? "Edit trade" : "Add trade"}</h2>
        <div className="hint">Log the trade with full context — your future self reviews this.</div>
      </div>

      <div className="cols">
        <div className="grid">
          <div className="fld"><label>Date</label><input type="date" value={t.date || ""} onChange={set("date")} /></div>
          <div className="fld"><label>Symbol</label><input value={t.symbol || ""} onChange={set("symbol")} placeholder="BTCUSD" /></div>
          <div className="fld"><label>Direction</label>
            <div className="seg">
              <button type="button" data-v="Long" className={dir === "Long" ? "on" : ""} onClick={() => setT({ ...t, direction: "Long" })}>Long</button>
              <button type="button" data-v="Short" className={dir === "Short" ? "on" : ""} onClick={() => setT({ ...t, direction: "Short" })}>Short</button>
            </div>
          </div>
          <div className="fld"><label>Result</label>
            <div className="seg">
              {["Win", "Loss", "BE"].map((o) => (
                <button key={o} type="button" data-v={o} className={out === o ? "on" : ""} onClick={() => setT({ ...t, outcome: out === o ? "" : o })}>{o}</button>
              ))}
            </div>
          </div>
          <div className="fld"><label>Setup</label><input value={t.setup || ""} onChange={set("setup")} placeholder="QML / Rejection / EMF…" /></div>
          <div className="fld"><label>TF bias</label><input value={t.tf_bias || ""} onChange={set("tf_bias")} placeholder="1h up · 5m pullback" /></div>
          <div className="fld"><label>Entry</label><input type="number" step="any" value={t.entry ?? ""} onChange={set("entry")} /></div>
          <div className="fld"><label>Stop</label><input type="number" step="any" value={t.stop ?? ""} onChange={set("stop")} /></div>
          <div className="fld"><label>Exit</label><input type="number" step="any" value={t.exit ?? ""} onChange={set("exit")} /></div>
          <div className="fld"><label>Qty / size</label><input type="number" step="any" value={t.qty ?? ""} onChange={set("qty")} /></div>
          <div className="fld"><label>Risk ($ at stop)</label><input type="number" step="any" value={t.risk ?? preview.risk ?? ""} onChange={set("risk")} /></div>
          <div className="fld"><label>P&L (realized)</label><input type="number" step="any" value={t.pnl ?? preview.pnl ?? ""} onChange={set("pnl")} /></div>
        </div>

        <div className="grid">
          <div className="fld full"><label>Logic / why I took it</label><textarea style={{ minHeight: 120 }} value={t.logic || ""} onChange={set("logic")} placeholder="What was the thesis? What confirmed it?" /></div>
          <div className="fld full"><label>Notes / lessons</label><textarea style={{ minHeight: 120 }} value={t.notes || ""} onChange={set("notes")} placeholder="What went right/wrong, emotions, what to repeat or avoid…" /></div>
          <div className="fld"><label>Platform fee</label><input type="number" step="any" value={t.fee ?? ""} onChange={set("fee")} /></div>
          <div className="fld"><label>Tags</label><input value={t.tags || ""} onChange={set("tags")} placeholder="comma,separated" /></div>
          <div className="fld full"><label>Discipline rating</label>
            <div className="ratepick">
              {[1, 2, 3, 4, 5].map((v) => (
                <span key={v} className={v <= rating ? "on" : ""} onClick={() => setT({ ...t, rating: rating === v ? "" : v })}>★</span>
              ))}
            </div>
          </div>
          <div className="fld full"><label>Screenshots</label>
            {isPro
              ? <div className="dropzone">📎 Paste a screenshot (⌘V) to attach</div>
              : <div className="dropzone">🔒 Screenshot attachments are a Pro feature</div>}
            {images.length > 0 && (
              <div className="shots">
                {images.map((p, i) => (
                  <div className="shot" key={i}>
                    <img src={p.startsWith("http") ? p : "/" + p} alt="" />
                    <button type="button" onClick={() => rmShot(i)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* live calc bar */}
      <div className="calc">
        <div className="ci">
          <span className="ci-ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg></span>
          <span className="ci-tx"><span className="cl">R-multiple</span><b className={sgn(preview.r_multiple)}>{preview.r_multiple == null ? "—" : fmt.num(preview.r_multiple, 2) + "R"}</b></span>
        </div>
        <div className="ci">
          <span className="ci-ic"><svg viewBox="0 0 24 24"><path d="M4 18l5-5 3.5 3 6.5-7" /><path d="M19 9V6.5M19 9h-2.5" /></svg></span>
          <span className="ci-tx"><span className="cl">Computed P&L</span><b className={sgn(preview.pnl)}>{preview.pnl == null ? "—" : fmt.money(preview.pnl)}</b></span>
        </div>
        <div className="ci">
          <span className="ci-ic"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4-3 6.5-7 7.5C8 17.5 5 15 5 11V6z" /></svg></span>
          <span className="ci-tx"><span className="cl">Risk at stop</span><b>{preview.risk == null ? "—" : fmt.money(preview.risk)}</b></span>
        </div>
      </div>

      {err && <div className="error">{err}</div>}
      <div className="modal-actions">
        <span />
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="btn" type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save trade"}</button>
        </div>
      </div>
    </div>
  );
}
