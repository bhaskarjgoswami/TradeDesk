import { useEffect, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { useFeedback } from "../lib/feedback";
import { doneToday, routineDay } from "../lib/routine";

// Today's checked steps with optimistic updates (saving prefs takes a round trip).
function useRoutineProgress() {
  const { prefs, savePrefs } = useAuth();
  const { toast } = useFeedback();
  const routine = prefs.routine;
  const [done, setDone] = useState(() => doneToday(prefs.routine_progress, routine));
  useEffect(() => { setDone(doneToday(prefs.routine_progress, routine)); }, [prefs.routine_progress, routine]);

  function toggle(title) {
    const next = done.includes(title) ? done.filter((t) => t !== title) : [...done, title];
    setDone(next);
    savePrefs({ routine_progress: { day: routineDay(routine.resetTime), done: next } })
      .catch(() => { setDone(done); toast("Couldn't save your routine progress", "error"); });
  }
  return { routine, done, toggle, complete: routine.steps.length > 0 && done.length >= routine.steps.length };
}

function Steps({ routine, done, toggle }) {
  return (
    <ul className="rt-steps">
      {routine.steps.map((s) => {
        const on = done.includes(s.title);
        return (
          <li key={s.title} className={on ? "on" : ""}>
            <button type="button" role="checkbox" aria-checked={on} className="rt-box" onClick={() => toggle(s.title)}>{on ? "✓" : ""}</button>
            <span className="rt-title" onClick={() => toggle(s.title)}>{s.title}</span>
            {s.link && <a className="rt-link" href={s.link} target="_blank" rel="noopener noreferrer">Open ↗</a>}
          </li>
        );
      })}
    </ul>
  );
}

// Collapsible strip at the top of the Daily Journal.
export function RoutinePanel() {
  const { routine, done, toggle, complete } = useRoutineProgress();
  const [open, setOpen] = useState(!complete);
  useEffect(() => { if (complete) setOpen(false); }, [complete]);
  if (!routine.enabled || routine.steps.length === 0) return null;
  return (
    <div className={"rt-panel" + (complete ? " complete" : "")}>
      <button type="button" className="rt-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="rt-name">Pre-market routine</span>
        <span className="rt-progress">{complete ? "Done for today ✓" : `${done.length} / ${routine.steps.length}`}</span>
        <span className="rt-bar"><span style={{ width: `${(100 * done.length) / routine.steps.length}%` }} /></span>
        <span className="acc-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && <Steps routine={routine} done={done} toggle={toggle} />}
    </div>
  );
}

// Optional popup once per session when the app opens with steps unchecked.
export function RoutinePopup() {
  const { routine, done, toggle, complete } = useRoutineProgress();
  // Decided once when the app opens: turning the popup on in Settings later
  // shouldn't throw it over the page you're on.
  const [armed] = useState(() => routine.enabled && routine.popup);
  const [show, setShow] = useState(() => {
    try { return sessionStorage.getItem("td_routine_seen") !== routineDay(routine.resetTime); } catch { return true; }
  });
  const close = () => {
    setShow(false);
    try { sessionStorage.setItem("td_routine_seen", routineDay(routine.resetTime)); } catch {}
  };
  useEffect(() => {
    if (!show) return;
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }); // eslint-disable-line
  if (!armed || !show || !routine.enabled || !routine.popup || routine.steps.length === 0 || complete) return null;
  return (
    <div className="um-overlay" onClick={close}>
      <div className="um-card rt-pop" role="dialog" aria-modal="true" aria-label="Pre-market routine" onClick={(e) => e.stopPropagation()}>
        <button className="um-x" type="button" onClick={close} title="Close">✕</button>
        <h2 className="um-title">Before you trade today</h2>
        <p className="um-sub">{done.length} of {routine.steps.length} done. Prepared traders make fewer impulsive trades.</p>
        <Steps routine={routine} done={done} toggle={toggle} />
        <div className="um-actions"><button type="button" className="btn" onClick={close}>Continue to journal</button></div>
      </div>
    </div>
  );
}
