import { Link } from "react-router-dom";
import { BRAND } from "../lib/brand";
import { Icon } from "../lib/ui";

const FEATURES = [
  { icon: "book", title: "Daily journal", text: "Every trading day on one page: trades, P&L, win rate and profit factor, with a pre-trade checklist you define." },
  { icon: "bolt", title: "Delta Exchange import", text: "Pull the day's fills and rebuild them into round-trip trades with entry, exit, stop, fees and realized P&L." },
  { icon: "chart", title: "Performance", text: "Equity curve, average R, best and worst trades, and a breakdown by setup so you can see where your edge actually is." },
  { icon: "card", title: "Screenshots", text: "Paste a chart straight into the trade. Stored privately and shown only to you." },
];

export function PublicFooter() {
  return (
    <footer className="pub-foot">
      <span>© {new Date().getFullYear()} {BRAND}</span>
      <nav>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/refunds">Refunds</Link>
        <Link to="/contact">Contact</Link>
      </nav>
    </footer>
  );
}

export function PublicHeader() {
  return (
    <header className="pub-head">
      <Link to="/" className="pub-brand"><span className="pub-mark">{Icon.book}</span>{BRAND}</Link>
      <nav>
        <a href="/#pricing">Pricing</a>
        <Link to="/login" className="btn ghost">Sign in</Link>
        <Link to="/login?mode=signup" className="btn">Start free</Link>
      </nav>
    </header>
  );
}

export default function Landing() {
  return (
    <div className="pub">
      <PublicHeader />
      <main>
        <section className="pub-hero">
          <h1>Review every trade.<br />Sharpen your edge.</h1>
          <p>A private trading journal for crypto and Indian traders. Log setups, screenshots and P&amp;L, import your Delta Exchange fills, and see what is really working.</p>
          <div className="pub-cta">
            <Link to="/login?mode=signup" className="btn">Start journaling free</Link>
            <a href="#features" className="btn ghost">See features</a>
          </div>
        </section>

        <section id="features" className="pub-grid">
          {FEATURES.map((f) => (
            <div className="pub-card" key={f.title}>
              <span className="pub-ic">{Icon[f.icon]}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </section>

        <section id="pricing" className="pub-pricing">
          <h2>Simple pricing</h2>
          <div className="pub-plans">
            <div className="pub-card">
              <h3>Free</h3>
              <div className="pub-price">₹0 / $0</div>
              <ul><li>2 trades per day</li><li>Daily journal and calendar</li><li>Performance stats</li><li>Delta import and screenshots</li></ul>
            </div>
            <div className="pub-card featured">
              <h3>Pro</h3>
              <div className="pub-price">₹199/mo · $9/mo</div>
              <ul><li>Unlimited trades per day</li><li>No daily cap on Delta imports</li><li>Annual: ₹1,990 / $90 (2 months free)</li><li>One-time payment, no auto-renew</li></ul>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
