import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// App-wide toasts and an in-app replacement for window.confirm / window.prompt.
//   const { toast, ask } = useFeedback();
//   toast("Trade saved");                       toast("Failed", "error")
//   if (await ask({ title, body, confirmLabel, danger })) ...
//   const v = await ask({ title, input: { placeholder } })   -> string | null
//   await ask({ ..., typeToConfirm: "DELETE" })              -> true | false
const Ctx = createContext(null);

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);

  const toast = useCallback((text, kind = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);

  const ask = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);

  return (
    <Ctx.Provider value={{ toast, ask }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={"toast " + t.kind}>{t.text}</div>)}
      </div>
      {dialog && <Dialog {...dialog} close={(v) => { dialog.resolve(v); setDialog(null); }} />}
    </Ctx.Provider>
  );
}

function Dialog({ title, body, confirmLabel = "Confirm", danger, input, typeToConfirm, close }) {
  const [val, setVal] = useState("");
  const ref = useRef(null);
  const needsText = Boolean(input || typeToConfirm);
  const ok = typeToConfirm ? val === typeToConfirm : input ? val.trim() !== "" : true;
  const cancel = () => close(input ? null : false);
  const submit = () => { if (ok) close(input ? val.trim() : true); };

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e) => e.key === "Escape" && cancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line

  return (
    <div className="um-overlay" onClick={cancel}>
      <div className="um-card dlg" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="um-title">{title}</h2>
        {body && <p className="um-sub">{body}</p>}
        {needsText && (
          <input ref={ref} className="dlg-input" value={val} onChange={(e) => setVal(e.target.value)}
                 placeholder={typeToConfirm ? `Type ${typeToConfirm} to confirm` : input?.placeholder}
                 maxLength={input?.maxLength || 300}
                 onKeyDown={(e) => e.key === "Enter" && submit()} />
        )}
        <div className="um-actions">
          <button type="button" className="btn ghost" onClick={cancel} ref={needsText ? undefined : ref}>Cancel</button>
          <button type="button" className={"btn" + (danger ? " danger" : "")} onClick={submit} disabled={!ok}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export const useFeedback = () => useContext(Ctx);
