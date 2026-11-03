import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

// Written notes for one trading day, autosaved. Mount with key={date} so each
// day gets its own instance: a pending save always belongs to the day it was
// typed on, and it is flushed when you switch days or leave the page.
const SECTIONS = [
  { title: "Pre-market", fields: [
    ["market", "Market context", "Overnight moves, news, key levels, HTF bias…"],
    ["watchlist", "Watchlist & plan", "What you'll trade, where, and what would invalidate it"],
  ]},
  { title: "Daily recap", fields: [
    ["did_great", "What went well", "Good decisions, patience, clean execution"],
    ["mistakes", "Mistakes", "What you did that broke the plan, and why"],
    ["reinforcement", "Lesson for tomorrow", "One thing to repeat or fix"],
  ]},
  { title: "Overall", fields: [["overall", "", "How did the day feel overall?"]] },
];
const FIELDS = SECTIONS.flatMap((s) => s.fields.map((f) => f[0]));
const SAVE_DELAY = 900;

export default function DayNotes({ date, initial, onSaved }) {
  const [log, setLog] = useState(() => ({ ...Object.fromEntries(FIELDS.map((f) => [f, ""])), ...(initial || {}) }));
  const [status, setStatus] = useState("");
  const timer = useRef(null);
  const pending = useRef(null);
  const hasText = FIELDS.some((f) => (log[f] || "").trim());
  const [open, setOpen] = useState(hasText);

  async function flush() {
    clearTimeout(timer.current);
    const body = pending.current;
    if (!body) return;
    pending.current = null;
    setStatus("Saving…");
    try {
      await api.saveDaylog(body);
      setStatus("Saved");
      onSaved?.();
    } catch (e) {
      pending.current = pending.current || body; // keep it for the next attempt
      setStatus("Not saved: " + (e.message || "network error"));
    }
  }

  // flush on unmount (day switch / navigation)
  useEffect(() => () => { flush(); }, []); // eslint-disable-line

  function edit(field, value) {
    const next = { ...log, [field]: value };
    setLog(next);
    pending.current = { date, ...Object.fromEntries(["tags", "checklist", ...FIELDS].map((f) => [f, next[f] || ""])) };
    setStatus("Unsaved changes");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  }

  return (
    <div className="dn">
      <button type="button" className="dn-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dn-name">Day notes</span>
        <span className="dn-status" role="status">{status || (hasText ? "" : "Nothing written yet")}</span>
        <span className="acc-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="dn-body">
          {SECTIONS.map((s) => (
            <section key={s.title} className="dn-sec">
              <h4>{s.title}</h4>
              {s.fields.map(([f, label, ph]) => (
                <label key={f} className="dn-field">
                  {label && <span>{label}</span>}
                  <textarea value={log[f] || ""} placeholder={ph} maxLength={10000}
                            onChange={(e) => edit(f, e.target.value)} onBlur={flush} />
                </label>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
