import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import { Icon } from "./ui";

const PLANS = [
  {
    key: "free", name: "Free", tagline: "Start journaling", icon: "book",
    price: "$0", unit: null,
    features: ["Up to 50 trades / month", "Manual trade entry", "Daily journal & calendar", "Performance stats"],
  },
  {
    key: "pro", name: "Pro", tagline: "Sync, analyze, scale", icon: "chart", popular: true,
    price: "$9", unit: ["USD / month", "billed monthly"],
    featHead: "Everything in Free, and:",
    features: ["Unlimited trades", "Delta auto-sync (pull fills)", "Screenshot attachments", "Mobile app access", "Priority support"],
  },
];

export default function PlanCards() {
  const { tier, refreshTier } = useAuth();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("upgraded")) { setMsg("🎉 Welcome to Pro!"); refreshTier(); }
    /* eslint-disable-next-line */
  }, []);

  async function upgrade() {
    setBusy(true); setMsg("Redirecting to checkout…");
    try { const { url } = await api.checkout(); location.href = url; }
    catch (e) { setMsg(e.message); setBusy(false); }
  }
  async function manage() {
    setBusy(true);
    try { const { url } = await api.portal(); location.href = url; }
    catch (e) { setMsg(e.message); setBusy(false); }
  }

  return (
    <>
      {msg && <div className="ex-note" style={{ marginBottom: 14 }}>{msg}</div>}
      <div className="plan-grid">
        {PLANS.map((p) => {
          const isCurrent = p.key === tier;
          return (
            <div className={"plan-card" + (p.popular ? " featured" : "") + (isCurrent ? " current" : "")} key={p.key}>
              {p.popular && !isCurrent && <span className="pc-pop">Popular</span>}
              <div className="pc-top">
                <span className="pc-ic">{Icon[p.icon]}</span>
                <div className="pc-name">{p.name}</div>
                <div className="pc-tag">{p.tagline}</div>
                <div className="pc-price">
                  <span className="pc-amt">{p.price}</span>
                  {p.unit && <span className="pc-unit">{p.unit[0]}<br />{p.unit[1]}</span>}
                </div>

                {isCurrent ? (
                  <button className="pc-btn" disabled>Current plan</button>
                ) : p.key === "pro" ? (
                  <button className="pc-btn primary" onClick={upgrade} disabled={busy}>Get Pro plan</button>
                ) : (
                  <button className="pc-btn ghost" onClick={manage} disabled={busy}>Switch to Free</button>
                )}
                {p.key === "pro" && !isCurrent && <div className="pc-note">No commitment · Cancel anytime</div>}
              </div>

              <div className="pc-divider" />

              <div className="pc-body">
                {p.featHead && <div className="pc-feathead">{p.featHead}</div>}
                <ul className="pc-feats">
                  {p.features.map((f) => (
                    <li key={f}><span className="pc-check">{Icon.check}</span>{f}</li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
