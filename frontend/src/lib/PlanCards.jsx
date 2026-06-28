import { useState } from "react";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import { Icon } from "./ui";

// Prices shown to the user. Keep in sync with backend RAZORPAY_PRICE_* config.
const PRICING = {
  INR: {
    monthly: { amt: "₹199", unit: ["INR / month", "billed monthly"], desc: "Pro — Monthly" },
    annual: { amt: "₹1,990", unit: ["INR / year", "2 months free"], desc: "Pro — Annual" },
  },
  USD: {
    monthly: { amt: "$9", unit: ["USD / month", "billed monthly"], desc: "Pro — Monthly" },
    annual: { amt: "$90", unit: ["USD / year", "2 months free"], desc: "Pro — Annual" },
  },
};

// Default to ₹ for India, $ everywhere else — user can switch.
function defaultCurrency() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return tz === "Asia/Kolkata" || tz === "Asia/Calcutta" ? "INR" : "USD";
  } catch { return "USD"; }
}

const FREE = {
  name: "Free", tagline: "Start journaling", icon: "book",
  features: ["Up to 2 trades / day", "Manual trade entry", "Daily journal & calendar", "Performance stats"],
};
const PRO_FEATURES = ["Unlimited trades", "Exchange auto sync", "Screenshot attachments", "Mobile app access", "Priority support"];

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function PlanCards() {
  const { tier, refreshTier, expiresAt } = useAuth();
  const [currency] = useState(defaultCurrency()); // 'INR' for India tz, else 'USD' — auto-detected
  const [cycle, setCycle] = useState("monthly"); // 'monthly' | 'annual'
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const isPro = tier === "pro";
  const price = PRICING[currency][cycle];

  async function upgrade() {
    setBusy(true);
    setMsg("Starting secure checkout…");
    try {
      const ok = await loadRazorpay();
      if (!ok) throw new Error("Couldn't load Razorpay. Check your connection and retry.");
      const order = await api.checkout(cycle, currency);
      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: "TradeDesk",
        description: PRICING[currency]?.[order.plan]?.desc || "Pro",
        prefill: { email: order.email },
        theme: { color: "#6366f1" },
        handler: async (resp) => {
          setMsg("Verifying payment…");
          try {
            await api.verifyPayment({
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            setMsg("🎉 Welcome to Pro!");
            refreshTier();
          } catch (e) {
            setMsg("Payment received but verification failed — contact support if Pro isn't active. " + e.message);
          }
          setBusy(false);
        },
        modal: { ondismiss: () => { setBusy(false); setMsg(""); } },
      });
      rzp.on("payment.failed", (r) => {
        setMsg("Payment failed: " + (r.error?.description || "please try again"));
        setBusy(false);
      });
      rzp.open();
    } catch (e) {
      setMsg(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      {msg && <div className="ex-note" style={{ marginBottom: 14 }}>{msg}</div>}

      {!isPro && (
        <div className="bill-bar">
          <div className="bill-seg">
            <button className={cycle === "monthly" ? "on" : ""} onClick={() => setCycle("monthly")}>Monthly</button>
            <button className={cycle === "annual" ? "on" : ""} onClick={() => setCycle("annual")}>
              Annual <span className="bill-save">SAVE 16%</span>
            </button>
          </div>
        </div>
      )}

      <div className="plan-grid">
        {/* Free */}
        <div className={"plan-card" + (!isPro ? " current" : "")}>
          <div className="pc-top">
            <span className="pc-ic">{Icon[FREE.icon]}</span>
            <div className="pc-name">{FREE.name}</div>
            <div className="pc-tag">{FREE.tagline}</div>
            <div className="pc-price"><span className="pc-amt">{currency === "INR" ? "₹0" : "$0"}</span></div>
            {!isPro
              ? <button className="pc-btn" disabled>Current plan</button>
              : <button className="pc-btn" disabled>Free</button>}
          </div>
          <div className="pc-divider" />
          <div className="pc-body">
            <ul className="pc-feats">
              {FREE.features.map((f) => (
                <li key={f}><span className="pc-check">{Icon.check}</span>{f}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Pro */}
        <div className={"plan-card featured" + (isPro ? " current" : "")}>
          {!isPro && <span className="pc-pop">Popular</span>}
          <div className="pc-top">
            <span className="pc-ic">{Icon.chart}</span>
            <div className="pc-name">Pro</div>
            <div className="pc-tag">Sync, analyze, scale</div>
            <div className="pc-price">
              <span className="pc-amt">{price.amt}</span>
              <span className="pc-unit">{price.unit[0]}<br />{price.unit[1]}</span>
            </div>
            {isPro ? (
              <button className="pc-btn" disabled>Current plan</button>
            ) : (
              <button className="pc-btn primary" onClick={upgrade} disabled={busy}>
                Get Pro — {price.amt}
              </button>
            )}
            {isPro
              ? expiresAt && <div className="pc-note">Active until {new Date(expiresAt).toLocaleDateString()}</div>
              : <div className="pc-note">One-time payment · no auto-renew</div>}
          </div>
          <div className="pc-divider" />
          <div className="pc-body">
            <div className="pc-feathead">Everything in Free, and:</div>
            <ul className="pc-feats">
              {PRO_FEATURES.map((f) => (
                <li key={f}><span className="pc-check">{Icon.check}</span>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
