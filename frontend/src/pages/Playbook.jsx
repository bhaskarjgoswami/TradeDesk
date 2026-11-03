import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";

const EMPTY = { name: "", description: "", checklist: [], exit_rules: "", management: "", notes: "", active: true };

// Strategies with their own pre-trade checklist. Picking one in the trade form
// swaps in its checklist; Performance breaks results down per playbook.
export default function Playbook() {
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null); // playbook id | "new"
  const [draft, setDraft] = useState(EMPTY);
  const [item, setItem] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const { ask, toast } = useFeedback();

  async function load(selectId) {
    const rows = await api.listPlaybooks();
    setList(rows);
    const pick = rows.find((p) => p.id === selectId) || rows[0];
    if (selectId === "new" || !pick) { setSel("new"); setDraft(EMPTY); }
    else { setSel(pick.id); setDraft(pick); }
  }
  useEffect(() => { load().catch((e) => { setList([]); setMsg(e.message); }); }, []);

  function open(p) { setSel(p.id); setDraft(p); setMsg(""); setItem(""); }
  function startNew() { setSel("new"); setDraft(EMPTY); setMsg(""); setItem(""); }
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });

  function addItem() {
    const v = item.trim();
    if (v && !draft.checklist.includes(v)) setDraft({ ...draft, checklist: [...draft.checklist, v] });
    setItem("");
  }
  function moveItem(i, d) {
    const c = draft.checklist.slice();
    const j = i + d;
    if (j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j], c[i]];
    setDraft({ ...draft, checklist: c });
  }

  async function save() {
    setBusy(true); setMsg("");
    try {
      const body = { ...EMPTY, ...draft };
      const saved = sel === "new" ? await api.createPlaybook(body) : await api.updatePlaybook(sel, body);
      await load(saved.id);
      toast("Playbook saved");
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }
  async function remove() {
    const n = draft.trade_count || 0;
    const ok = await ask({
      title: `Delete "${draft.name}"?`,
      body: n ? `${n} trade${n > 1 ? "s" : ""} will keep their data but lose this playbook link. Archive it instead to keep the history.` : "This playbook will be removed.",
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    try { await api.deletePlaybook(sel); await load(); setMsg(""); toast("Playbook deleted"); }
    catch (e) { setMsg(e.message); }
  }

  if (!list) return <main className="main"><div className="pane-pad"><div className="muted">Loading…</div></div></main>;

  return (
    <>
      <section className="middle">
        <div className="midhead"><h2>Playbook ({list.length})</h2></div>
        <div className="daycards">
          <button type="button" className="btn pb-new" onClick={startNew}>+ New playbook</button>
          {list.length === 0 && <div className="emptyday">Write down each strategy you trade, with the checklist that must be true before you enter.</div>}
          {list.map((p) => (
            <div key={p.id} className={"daycard" + (p.id === sel ? " sel" : "")} onClick={() => open(p)}
                 role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(p)}>
              <div className="dc-date">{p.name}{!p.active && <span className="pill" style={{ marginLeft: 8 }}>Archived</span>}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {p.checklist.length} criteria · {p.trade_count} trade{p.trade_count === 1 ? "" : "s"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <main className="main">
        <div className="pane-pad pb-edit">
          <h1>{sel === "new" ? "New playbook" : draft.name || "Playbook"}</h1>
          <div className="tradeform pb-form">
            <div className="grid">
              <div className="fld full"><label>Name</label><input value={draft.name} onChange={set("name")} placeholder="QML reversal" maxLength={120} /></div>
              <div className="fld full"><label>Description</label><textarea value={draft.description || ""} onChange={set("description")} placeholder="What is the setup, which market and timeframe, when does it work best?" /></div>

              <div className="fld full">
                <label>Pre-trade checklist</label>
                <div className="pb-list">
                  {draft.checklist.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Add the criteria that must be true before you enter.</div>}
                  {draft.checklist.map((c, i) => (
                    <div className="pb-item" key={c}>
                      <span className="pb-n">{i + 1}</span><span className="pb-t">{c}</span>
                      <button type="button" className="icobtn" onClick={() => moveItem(i, -1)} aria-label={`Move ${c} up`} disabled={i === 0}>↑</button>
                      <button type="button" className="icobtn" onClick={() => moveItem(i, 1)} aria-label={`Move ${c} down`} disabled={i === draft.checklist.length - 1}>↓</button>
                      <button type="button" className="icobtn" onClick={() => setDraft({ ...draft, checklist: draft.checklist.filter((x) => x !== c) })} aria-label={`Remove ${c}`}>×</button>
                    </div>
                  ))}
                  <div className="pb-add">
                    <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. HTF bias agrees with entry" maxLength={300}
                           onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} />
                    <button type="button" className="btn ghost" onClick={addItem}>Add</button>
                  </div>
                </div>
              </div>

              <div className="fld full"><label>Exit rules</label><textarea value={draft.exit_rules || ""} onChange={set("exit_rules")} placeholder="Stop placement, targets, when to cut early" /></div>
              <div className="fld full"><label>Trade management</label><textarea value={draft.management || ""} onChange={set("management")} placeholder="Partials, moving the stop, adding to winners" /></div>
              <div className="fld full"><label>Notes</label><textarea value={draft.notes || ""} onChange={set("notes")} /></div>
              <div className="fld">
                <label>Status</label>
                <div className="seg">
                  <button type="button" className={draft.active ? "on" : ""} onClick={() => setDraft({ ...draft, active: true })}>Active</button>
                  <button type="button" className={!draft.active ? "on" : ""} onClick={() => setDraft({ ...draft, active: false })}>Archived</button>
                </div>
              </div>
            </div>
            {msg && <div className={msg === "Saved." ? "muted" : "error"} style={{ marginTop: 10 }}>{msg}</div>}
            <div className="modal-actions">
              {sel !== "new" ? <button type="button" className="btn danger" onClick={remove}>Delete</button> : <span />}
              <button type="button" className="btn" onClick={save} disabled={busy || !draft.name.trim()}>{busy ? "Saving…" : "Save playbook"}</button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
