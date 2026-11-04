import { useAuth } from "../lib/AuthContext";
import PlanCards from "../lib/PlanCards";
import { Icon } from "../lib/ui";

export default function Billing() {
  const { session, user, isPro, expiresAt, tierStatus } = useAuth();
  return (
    <div className="billing-surface">
      <main className="billing-page">
        <nav className="billing-topbar" aria-label="Billing navigation">
          <a className="billing-brand" href="/app"><span>{Icon.book}</span>TradeDesk</a>
          <div className="billing-toplinks"><a href="/contact">Need a hand?</a><a className="billing-back" href="/app"><span aria-hidden="true">←</span> Back to journal</a></div>
        </nav>
        <header className="billing-heading">
          <div className="billing-hero-copy"><div className="billing-eyebrow"><span /> PLAN &amp; BILLING</div><h1>Choose your next level.</h1><p>A trading journal for every market, wherever you trade.</p></div>
          {session && <aside className="billing-membership" aria-label="Current subscription">
            <div className="billing-membership-label">YOUR MEMBERSHIP <span className="billing-active">Current plan</span></div>
            <div className="billing-membership-plan"><span className="billing-member-icon">{isPro ? Icon.bolt : Icon.book}</span><div><strong>{tierStatus === "ready" ? `TradeDesk ${isPro ? "Pro" : "Free"}` : "Your membership"}</strong><span>{tierStatus !== "ready" ? (tierStatus === "error" ? "Membership temporarily unavailable" : "Loading membership…") : isPro && expiresAt ? `Active until ${new Date(expiresAt).toLocaleDateString()}` : isPro ? "Unlimited daily trades" : "A thoughtful place to start"}</span></div></div>
            <div className="billing-account">{user?.email}</div>
          </aside>}
        </header>
        <section className="billing-plans" aria-label="Available plans"><PlanCards /></section>
        <section className="billing-assurances" aria-label="Payment information">
          <div><span className="billing-assurance-icon">{Icon.card}</span><span><strong>Secure by design</strong><small>Checkout powered by Razorpay</small></span></div>
          <div><span className="billing-assurance-icon">{Icon.check}</span><span><strong>You stay in control</strong><small>One-time payment. No auto-renew.</small></span></div>
          <div><span className="billing-assurance-icon">{Icon.folder}</span><span><strong>Your journal comes with you</strong><small>Keep your existing trades when upgrading</small></span></div>
        </section>
        <footer className="billing-footer"><span>Built for the process. Designed for you.</span><div><a href="/terms">Terms</a><a href="/refunds">Refund policy</a><a href="/contact">Contact support <span aria-hidden="true">↗</span></a></div></footer>
      </main>
    </div>
  );
}
