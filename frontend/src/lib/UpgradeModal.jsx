import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Shown when a free user hits the 2-trades-per-day limit.
export default function UpgradeModal({ open, onClose }) {
  const nav = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="um-overlay" onClick={onClose}>
      <div className="um-card" onClick={(e) => e.stopPropagation()}>
        <button className="um-x" type="button" onClick={onClose} title="Close">✕</button>
        <div className="um-badge">PRO</div>
        <h2 className="um-title">You've hit the free daily limit</h2>
        <p className="um-sub">
          Free accounts can log <b>2 trades per day</b>. Upgrade to Pro for
          unlimited trades and keep journaling without limits.
        </p>
        <ul className="um-feats">
          <li>Unlimited trades — no daily cap</li>
          <li>Delta auto-sync & screenshot attachments</li>
          <li>Everything in Free</li>
        </ul>
        <div className="um-actions">
          <button className="btn ghost" type="button" onClick={onClose}>Maybe later</button>
          <button
            className="btn"
            type="button"
            onClick={() => { onClose(); nav("/settings"); }}
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}
