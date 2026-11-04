import PlanCards from "../lib/PlanCards";
import { Icon } from "../lib/ui";

export default function Billing() {
  return (
    <div className="billing-surface">
      <main className="billing-page">
        <nav className="billing-topbar" aria-label="Billing navigation">
          <a className="billing-brand" href="/app"><span>{Icon.book}</span>TradeDesk</a>
          <a className="billing-back" href="/app"><span aria-hidden="true">←</span> Back to journal</a>
        </nav>
        <header className="billing-heading">
          <h1>Plans &amp; billing</h1>
        </header>
        <section className="billing-plans" aria-label="Available plans"><PlanCards showMembership /></section>
        <footer className="billing-footer">
          <span>One-time payment · no auto-renew</span>
          <div><a href="/terms">Terms</a><a href="/refunds">Refunds</a><a href="/contact">Support</a></div>
        </footer>
      </main>
    </div>
  );
}
