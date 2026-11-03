import { useAuth } from "../lib/AuthContext";
import PlanCards from "../lib/PlanCards";

export default function Billing() {
  const { session, user, isPro, expiresAt } = useAuth();
  return (
    <main className="billing-page">
      <a className="billing-back" href="/app">← Back to journal</a>
      <header className="billing-heading">
        <div><h1>Plan &amp; billing</h1><p>Compare plans and manage your TradeDesk subscription.</p></div>
        {session && <span className="pill">{isPro ? "Pro" : "Free"} plan</span>}
      </header>
      {session ? <>
        <section className="billing-status" aria-label="Current subscription">
          <div><strong>Your current plan: {isPro ? "Pro" : "Free"}</strong><p>{user?.email}</p></div>
          <p>{isPro && expiresAt ? `Active until ${new Date(expiresAt).toLocaleDateString()}` : "Free includes up to 2 trades per day. Pro gives you unlimited trades."}</p>
        </section>
        <PlanCards />
      </> : <section className="billing-status"><div><strong>Sign in to manage your plan</strong><p>Use your TradeDesk account to view your subscription and upgrade.</p></div><a className="btn" href="/app">Sign in</a></section>}
      <footer className="billing-footer">Payments are processed securely by Razorpay. <a href="/refunds">Refund policy</a> · <a href="/contact">Contact support</a></footer>
    </main>
  );
}
