import { useEffect, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { useFeedback } from "../lib/feedback";
import { MAX_STEPS, normalizeRoutine } from "../lib/routine";

export default function RoutineSettings() {
  const { prefs, savePrefs } = useAuth();
  const { toast } = useFeedback();
  const [draft, setDraft] = useState(prefs.routine);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(prefs.routine); }, [prefs.routine]);
  const dirty = JSON.stringify(normalizeRoutine(draft)) !== JSON.stringify(prefs.routine);

  const setStep = (i, k, v) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));

  async function save() {
    setBusy(true);
    try { await savePrefs({ routine: normalizeRoutine(draft) }); toast("Routine saved"); }
    catch (e) { toast(e.message || "Couldn't save the routine", "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="set-sec">
      <div className="set-label">Pre-market routine</div>
      <div className="set-row"><span>Show the routine on the Daily Journal</span>
        <div className="seg" style={{ width: 140 }}>
          <button className={draft.enabled ? "on" : ""} onClick={() => setDraft({ ...draft, enabled: true })}>On</button>
          <button className={!draft.enabled ? "on" : ""} onClick={() => setDraft({ ...draft, enabled: false })}>Off</button>
        </div>
      </div>
      <div className="set-row"><span>Pop it up when I open the app with steps unchecked</span>
        <div className="seg" style={{ width: 140 }}>
          <button className={draft.popup ? "on" : ""} onClick={() => setDraft({ ...draft, popup: true })}>On</button>
          <button className={!draft.popup ? "on" : ""} onClick={() => setDraft({ ...draft, popup: false })}>Off</button>
        </div>
      </div>
      <div className="set-row"><span>New routine day starts at</span>
        <input type="time" value={draft.resetTime} onChange={(e) => setDraft({ ...draft, resetTime: e.target.value || "00:00" })} className="rt-time" />
      </div>

      <div className="rt-edit">
        {draft.steps.map((s, i) => (
          <div className="rt-edit-row" key={i}>
            <span className="pb-n">{i + 1}</span>
            <input value={s.title} onChange={(e) => setStep(i, "title", e.target.value)} placeholder="Step" maxLength={140} aria-label={`Step ${i + 1}`} />
            <input value={s.link} onChange={(e) => setStep(i, "link", e.target.value)} placeholder="Link (optional)" aria-label={`Step ${i + 1} link`} />
            <button type="button" className="icobtn" aria-label={`Remove step ${i + 1}`}
                    onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <div className="set-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn ghost" disabled={draft.steps.length >= MAX_STEPS}
                  onClick={() => setDraft({ ...draft, steps: [...draft.steps, { title: "", link: "" }] })}>
            + Add step ({draft.steps.length} / {MAX_STEPS})
          </button>
          <button type="button" className="btn" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save routine"}</button>
        </div>
      </div>
    </div>
  );
}
