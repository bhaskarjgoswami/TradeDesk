import LanguageSelector from "../components/LanguageSelector";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BRAND } from "../lib/brand";
import { Icon } from "../lib/ui";
import { PRICING, defaultCurrency } from "../lib/pricing";

const FEATURES = [
  { icon: "book", title: "Daily journal", text: "Every trading day on one page: trades, P&L, win rate and profit factor, with a pre-trade checklist you define." },
  { icon: "bolt", title: "Bring any broker", text: "Map your broker’s CSV columns or log trades manually. Keep your trading history together across markets and accounts." },
  { icon: "chart", title: "Performance", text: "Equity curve, average R, best and worst trades, and a breakdown by setup so you can see where your edge actually is." },
  { icon: "card", title: "Screenshots", text: "Paste a chart straight into the trade. Stored privately and shown only to you." },
  { icon: "check", title: "Pre-market routine", text: "A checklist you run before the open: review your plan, mark levels, set your max loss. Your process, not just your P&L." },
  { icon: "folder", title: "Trade plan", text: "Write down each setup with its rules and example charts, then tag trades to it and see which setups pay." },
];

// Factual promises, taken from the FAQ and privacy policy.
const PROMISES = [
  { icon: "check", title: "Private by default", text: "Your trades, notes and screenshots are visible only to you. We never sell or share journal data." },
  { icon: "folder", title: "Export or delete anytime", text: "Download a full backup of your journal from Settings, or delete your account and everything in it." },
  { icon: "card", title: "No auto-renew", text: "Pro is a one-time payment for 30 or 365 days. When it ends you go back to Free and keep all your trades." },
];

const FAQ = [
  ["Is my journal private?", "Yes. Your trades, notes and screenshots are visible only to you. We never sell or share journal data."],
  ["Can I export or delete my data?", "Any time. Download a full backup of your journal from Settings, or delete your account and everything in it."],
  ["Does Pro renew automatically?", "No. Pro is a one-time payment for 30 or 365 days. When it ends you go back to Free and keep all your trades."],
  ["Which brokers are supported?", "Any broker or exchange that exports a CSV of your trades. Delta Exchange can also sync fills directly with a read-only API key."],
  ["Can I get a refund?", "Yes. Ask within 7 days of paying for a full refund."],
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
        <LanguageSelector />
        <a href="/#pricing" className="pub-navlink">Pricing</a>
        <a href="/app" className="btn ghost pub-signin">Sign in</a>
        <a href="/app?signup=1" className="btn">Start free</a>
      </nav>
    </header>
  );
}

function PricingSection() {
  // Same India detection as the billing cards: saved choice, else an Indian time zone shows INR.
  const [currency] = useState(defaultCurrency);
  const [cycle, setCycle] = useState("monthly");
  const price = PRICING[currency][cycle];
  return (
    <section id="pricing" className="pub-pricing">
      <h2>Simple pricing</h2>
      <div className="pub-cycle" role="group" aria-label="Billing period">
        {[{ id: "monthly", label: "Monthly" }, { id: "annual", label: "Yearly" }].map(({ id, label }) => (
          <button key={id} type="button" className={cycle === id ? "on" : ""} aria-pressed={cycle === id} onClick={() => setCycle(id)}>
            {label}{id === "annual" && currency === "USD" && <span className="pub-save">2 months free</span>}
          </button>
        ))}
      </div>
      <div className="pub-plans">
        <div className="pub-card">
          <h3>Free</h3>
          <div className="pub-price"><span translate="no">{currency === "INR" ? "₹0" : "$0"}</span></div>
          <ul><li>Log up to 2 trades a day</li><li>Import your full trade history</li><li>Daily journal, calendar and stats</li><li>Screenshots on every trade</li></ul>
          <a href="/app?signup=1" className="btn ghost pub-plan-cta">Start free</a>
        </div>
        <div className="pub-card featured">
          <h3>Pro</h3>
          <div className="pub-price"><span translate="no">{price.amt}</span><span className="pub-per"> / <span>{cycle === "annual" ? "365 days" : "30 days"}</span></span></div>
          <ul><li>Unlimited trades every day</li><li>Full trade history import with no daily cap</li><li>Everything in Free</li><li>One-time payment, no auto-renew</li></ul>
          <a href="/app?signup=1" className="btn pub-plan-cta">Get Pro</a>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const { pathname } = useLocation();
  // /pricing and /#pricing land on the pricing section. The page scrolls inside .pub, so scroll after layout.
  useEffect(() => {
    const id = pathname === "/pricing" ? "pricing" : location.hash.slice(1);
    if (!id) return;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  return (
    <div className="pub">
      <PublicHeader />
      <main>
        <section className="pub-hero">
          <h1>Review every trade.<br />Sharpen your edge.</h1>
          <p>A private trading journal that checks your process, not just your P&amp;L. Bring trades from any broker, run your pre-market routine, and see which setups actually make money.</p>
          <div className="pub-cta">
            <a href="/app?signup=1" className="btn">Start journaling free</a>
            <a href="#features" className="btn ghost">See features</a>
          </div>
          <figure className="pub-shot">
            <div className="pub-frame">
              <div className="pub-frame-bar" aria-hidden="true"><i /><i /><i /></div>
              <img src="/landing/journal-calendar.webp" width="1800" height="1125" fetchpriority="high" alt="Journal calendar with daily P&L and one trading day open" />
            </div>
            <figcaption>Example data</figcaption>
          </figure>
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

        <section className="pub-showcase">
          <div className="pub-showcase-text">
            <span className="pub-ic">{Icon.check}</span>
            <h2>Check your process before the open</h2>
            <p>Tick off your trade plan, market news and routine steps before the open. Each day in the journal shows whether you did.</p>
          </div>
          <figure className="pub-shot">
            <div className="pub-frame">
              <img src="/landing/premarket-routine.webp" width="1400" height="849" loading="lazy" decoding="async" alt="Pre-market routine checklist" />
            </div>
            <figcaption>Example data</figcaption>
          </figure>
        </section>

        <section className="pub-trust" aria-label="Our promises">
          {PROMISES.map((p) => (
            <div className="pub-promise" key={p.title}>
              <span className="pub-ic">{Icon[p.icon]}</span>
              <div><h3>{p.title}</h3><p>{p.text}</p></div>
            </div>
          ))}
        </section>

        <PricingSection />

        <section id="faq" className="pub-faq" aria-labelledby="faqTitle">
          <h2 id="faqTitle">Questions</h2>
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}{q === "Can I get a refund?" && <> <Link to="/refunds">Refund policy</Link></>}</p>
            </details>
          ))}
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
