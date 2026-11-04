import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import { Icon } from "./ui";

// Prices shown to the user. Keep in sync with backend RAZORPAY_PRICE_* config.
const PRICING = {
  INR: {
    monthly: { amt: "₹99", unit: ["INR / month", "billed monthly"], desc: "Pro — Monthly" },
    annual: { amt: "₹699", unit: ["INR / year", "billed annually"], desc: "Pro — Annual" },
  },
  USD: {
    monthly: { amt: "$9", unit: ["USD / month", "billed monthly"], desc: "Pro — Monthly" },
    annual: { amt: "$90", unit: ["USD / year", "2 months free"], desc: "Pro — Annual" },
  },
};

// Default to ₹ for India, $ everywhere else — user can switch.
function defaultCurrency() {
  try {
    const saved = localStorage.getItem("tradedesk_billing_currency");
    if (["USD", "INR"].includes(saved)) return saved;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return tz === "Asia/Kolkata" || tz === "Asia/Calcutta" ? "INR" : "USD";
  } catch { return "USD"; }
}

const FREE = {
  name: "Free", tagline: "A clear foundation for your daily routine.", icon: "book",
  features: ["Up to 2 trades entry / day", "Daily journal & calendar", "Performance stats", "CSV imports from any broker", "Screenshot attachments"],
};
// Keep in sync with what the backend actually gates (trades.py FREE_DAILY_LIMIT).
const PRO_FEATURES = [
  "Unlimited trades entry per day",
  "No daily cap on trade imports",
  "Daily journal & calendar",
  "Performance stats",
  "CSV imports from any broker",
  "Screenshot attachments",
];

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
  const { session, tier, tierStatus, refreshTier } = useAuth();
  const [currency, setCurrency] = useState(defaultCurrency());
  const [cycle, setCycle] = useState("annual"); // 'monthly' | 'annual'
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const isPro = tier === "pro";
  const display = PRICING[currency][cycle];
  const price = catalog?.prices?.[currency]?.[cycle] != null ? {...display,amt:new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US",{style:"currency",currency,maximumFractionDigits:0}).format(catalog.prices[currency][cycle]/100)} : display;
  const checkoutAvailable = catalog?.checkout_available === true;
  const loadPlans = () => { setCatalogError(false); api.plans().then(setCatalog).catch(()=>setCatalogError(true)); };
  useEffect(loadPlans, []);
  const membershipReady = !session || tierStatus === "ready";

  async function upgrade() {
    if (!session || isPro || !membershipReady || !checkoutAvailable) return;
    setBusy(true);
    setMsg("Starting secure checkout…");
    try {
      let verificationStarted = false;
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
          verificationStarted = true;
          setMsg("Verifying payment…");
          try {
            await api.verifyPayment({
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            setMsg("🎉 Welcome to Pro!");
            await refreshTier();
          } catch (e) {
            setMsg("Payment received but verification failed — contact support if Pro isn't active. " + e.message);
          }
          setBusy(false);
        },
        modal: { ondismiss: () => { if (!verificationStarted) { setBusy(false); setMsg((current) => current.startsWith("Payment failed:") ? current : "Checkout closed."); } } },
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
      {catalogError && <p role="alert">Couldn’t load current checkout availability. <button className="btn" onClick={loadPlans}>Try again</button></p>}
      {catalog && !checkoutAvailable && <p role="status">Payments are being set up. Your journal remains available.</p>}
      {session && tierStatus === "loading" && <p role="status">Loading your membership…</p>}
      {session && tierStatus === "error" && <p role="alert">We couldn’t load your membership. <button className="btn" onClick={() => refreshTier().catch(() => {})}>Try again</button></p>}
      {msg && <div className="ex-note" role="status" aria-live="polite" style={{ marginBottom: 14 }}>{msg}</div>}

      <div className="bill-bar"><div className="bill-controls">
          <div className="bill-seg" role="group" aria-label="Billing period">
            <button className={cycle === "monthly" ? "on" : ""} aria-pressed={cycle === "monthly"} disabled={busy} onClick={() => setCycle("monthly")}>Monthly</button>
            <button className={cycle === "annual" ? "on" : ""} aria-pressed={cycle === "annual"} disabled={busy} onClick={() => setCycle("annual")}>
              Annual <span className="bill-save">{currency === "INR" ? "SAVE 41%" : "SAVE 16%"}</span>
            </button>
          </div></div>
          <div className="bill-controls">{catalog?.mode === "test" && <span className="billing-test-mode" role="status" aria-label="Test mode: simulated payments only" title="Simulated payments only">Test mode</span>}<div className="bill-seg" role="group" aria-label="Billing currency">{["USD", "INR"].map(code => <button key={code} type="button" className={currency === code ? "on" : ""} aria-pressed={currency === code} disabled={busy} onClick={() => { setCurrency(code); try { localStorage.setItem("tradedesk_billing_currency",code); } catch {} }}>{code === "USD" ? "$ USD" : "₹ INR"}</button>)}</div></div>
      </div>

      <div className="plan-grid">
        <article className={"plan-card" + (session && membershipReady && !isPro ? " current" : "")}>
          <div className="pc-top">
            <h2 className="pc-name">{FREE.name}</h2>
          </div>
          <div className="pc-divider" />
          <div className="pc-body">
            <ul className="pc-feats">{FREE.features.map((f) => <li key={f}><span className="pc-check" aria-hidden="true">{Icon.check}</span>{f}</li>)}</ul>
          </div>
          <div className="pc-bottom">
            <div className="pc-bottom-row"><div className="pc-price"><span className="pc-amt">{currency === "INR" ? "₹0" : "$0"}</span><span className="pc-unit">/ month</span></div><button className="pc-btn" disabled>{session && membershipReady && !isPro ? "Current plan" : "Free plan"}</button></div>
          </div>
        </article>
        <article className={"plan-card featured" + (isPro ? " current" : "")}>
          <div className="pc-top">
            <h2 className="pc-name">Pro</h2>
          </div>
          <div className="pc-divider" />
          <div className="pc-body">
            <ul className="pc-feats">{PRO_FEATURES.map((f) => <li key={f}><span className="pc-check" aria-hidden="true">{Icon.check}</span>{f}</li>)}</ul>
          </div>
          <div className="pc-bottom">
            <div className="pc-bottom-row"><div className="pc-price"><span className="pc-amt">{price.amt}</span><span className="pc-unit">/ {cycle === "monthly" ? "month" : "year"}</span></div>
              {!session ? <a className="pc-btn primary" href="/app?signup=1">Get Pro <span aria-hidden="true">→</span></a> : <button className="pc-btn primary" onClick={upgrade} disabled={isPro || busy || !membershipReady || !checkoutAvailable}>{busy ? "Opening checkout…" : <>{isPro ? "Current plan" : !checkoutAvailable ? "Checkout unavailable" : "Get Pro"} <span aria-hidden="true">→</span></>}</button>}
            </div>
          </div>
        </article>
      </div>
    </>
  );
}
