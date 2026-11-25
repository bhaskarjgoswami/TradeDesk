import { Navigate } from "react-router-dom";
import { useSyncExternalStore } from "react";
import { BRAND, SUPPORT_EMAIL, SUPPORT_URL, SUPPORT_LABEL, LEGAL_UPDATED } from "../lib/brand";
import { PublicHeader, PublicFooter } from "./Landing";

const mail = <a href={SUPPORT_URL}>{SUPPORT_LABEL}</a>;

// PLACEHOLDER: the owner has not supplied the legal entity yet. Set
// VITE_LEGAL_ENTITY and VITE_LEGAL_ADDRESS (or edit here) before relying on
// this policy; until then the page shows bracketed placeholders.
const LEGAL_ENTITY = import.meta.env.VITE_LEGAL_ENTITY || "";
const LEGAL_ADDRESS = import.meta.env.VITE_LEGAL_ADDRESS || "";
const entity = LEGAL_ENTITY || "[Company name]";
const address = LEGAL_ADDRESS || "[Registered address]";

// Only providers the code actually uses. Keep in sync with backend/app and vercel.json.
const PROCESSORS = [
  ["Supabase", "Database, sign-in, sign-up and password emails, private screenshot storage", "Japan (Tokyo, AWS ap-northeast-1)"],
  ["Render", "Application server (API)", "United States (Oregon)"],
  ["Vercel", "Website hosting and delivery", "Global edge network, United States"],
  ["Razorpay", "Payments for Pro", "India"],
  ["Sentry", "Error monitoring, when enabled (no journal data, tokens or email addresses)", "United States"],
];

const PAGES = {
  terms: {
    title: "Terms of Service",
    body: (
      <>
        <p>{`These terms govern your use of ${BRAND}, a trading journal web application. By creating an account you agree to them.`}</p>
        <h3>The service</h3>
        <p>{`${BRAND} lets you record trades, journal notes and screenshots, and import trade fills from supported exchanges using read-only API keys you provide. ${BRAND} never places orders on your behalf.`}</p>
        <h3>Not financial advice</h3>
        <p>{`Statistics, charts and any other output are records of your own data. Nothing in ${BRAND} is investment, trading or tax advice. Trading carries risk of loss and you are solely responsible for your decisions.`}</p>
        <h3>Your account</h3>
        <p>Keep your login credentials secure. Use exchange API keys with read-only permissions. You are responsible for activity under your account.</p>
        <h3>Plans and payment</h3>
        <p>The Free plan allows up to 2 trades per day. Pro is a one-time payment for a fixed period (30 days monthly, 365 days annual) processed by Razorpay. Pro does not renew automatically; when the period ends your account returns to Free and your data is kept.</p>
        <h3>Acceptable use</h3>
        <p>Do not misuse the service, attempt to access other users' data, or interfere with its operation. We may suspend accounts that do.</p>
        <h3>Availability and liability</h3>
        <p>The service is provided as is. We work to keep it available and your data safe but do not guarantee uninterrupted operation. To the extent permitted by law, our liability is limited to the amount you paid in the 12 months before a claim.</p>
        <h3>Changes</h3>
        <p>We may update these terms and will note the date below. Continued use after a change means you accept it.</p>
        <p>Questions: {mail}</p>
      </>
    ),
  },
  privacy: {
    title: "Privacy Policy",
    body: (
      <>
        <p>{`This policy explains what ${BRAND} collects, why, where it is processed and the choices you have. ${BRAND} is used by traders worldwide.`}</p>
        <h3>Who is responsible</h3>
        <p>The data controller is {entity}, {address}. Contact: {mail}.</p>
        <h3>What we store</h3>
        <ul>
          <li>Account: email address and a securely hashed password (managed by Supabase Auth).</li>
          <li>Optional profile details: name, photo, country, language, trading experience, age group and gender. Journal data you enter or import: trades, reviews, notes, playbooks, checklists, routine, preferences and chart screenshots.</li>
          <li>Optional profile details and feedback you submit, including attached images. Unsaved trade drafts stay in session storage in your current browser tab and are cleared on sign-out.</li>
          <li>Exchange API keys you save, encrypted by the application before storage.</li>
          <li>Plan status and payment reference IDs. Card and UPI details are handled by Razorpay and never reach us.</li>
          <li>Technical data: server logs (time, route, status, no request bodies) and reports of errors in your browser (error text, page path, browser version). Values that look like emails or tokens are removed before storage.</li>
          <li>Product usage: which of these steps your account reached on each day (opened the app, logged a trade, reviewed a trade, completed the routine), so we can see where the product needs work. No trade content, amounts or device details are included, and these records are deleted with your account.</li>
        </ul>
        <h3>How we use it</h3>
        <p>Only to provide the service: show your journal, compute your statistics, import your fills, manage your plan, keep the service secure and fix errors, and improve the product from the usage steps above. We do not sell your data or use it for advertising.</p>
        <h3>Legal basis (EU, EEA and UK users)</h3>
        <ul>
          <li>Contract: your account, journal, imports and Pro plan.</li>
          <li>Legitimate interests: security, abuse prevention, error monitoring and fixing bugs.</li>
          <li>Consent: optional profile details such as photo, age group and gender. You can remove them at any time in Settings.</li>
          <li>Legal obligation: payment records we must keep for tax and accounting law.</li>
        </ul>
        <h3>Where it is processed</h3>
        <p>Screenshots are private and served through short-lived signed links. When you connect an exchange, we contact that exchange with the read-only key you provided. We use these providers (sub-processors):</p>
        <div className="pub-table">
          <table>
            <thead><tr><th scope="col">Provider</th><th scope="col">Purpose</th><th scope="col">Location</th></tr></thead>
            <tbody>{PROCESSORS.map(([name, purpose, place]) => <tr key={name}><td>{name}</td><td>{purpose}</td><td>{place}</td></tr>)}</tbody>
          </table>
        </div>
        <h3>International transfers</h3>
        <p>Your data may be processed outside your country, including in Japan, the United States and India. Japan has an EU adequacy decision. For other transfers we rely on the Standard Contractual Clauses (and the UK Addendum) in our providers’ data processing terms.</p>
        <h3>Retention</h3>
        <p>We keep your data while your account exists. Deleting your account removes your active account, journal records and uploaded images straight away. Copies in provider backups roll off on the provider’s backup schedule, within up to 30 days. Payment records are kept as long as tax law requires. Server logs and error reports are deleted automatically by our providers, within 90 days.</p>
        <h3>Your rights</h3>
        <ul>
          <li>Access and export: Settings → Your data → download all your data.</li>
          <li>Correction: edit your profile and journal at any time.</li>
          <li>Deletion: Settings → Your data → delete your account.</li>
          <li>Objection and withdrawal of consent: contact us, or remove optional profile details yourself.</li>
          <li>Complaint: you can complain to your local data protection supervisory authority.</li>
        </ul>
        <p>For any request, contact {mail}. We reply within one month.</p>
        <h3>Changes</h3>
        <p>We will update the date below when this policy changes.</p>
      </>
    ),
  },
  refunds: {
    title: "Refund & Cancellation Policy",
    body: (
      <>
        <p>Pro is a one-time payment for a fixed period. There is no subscription to cancel and nothing renews automatically.</p>
        <h3>Refunds</h3>
        <p>If Pro does not work for you, contact {mail} within 7 days of payment with your registered email and Razorpay payment ID for a full refund. After 7 days, payments are non-refundable, and Pro stays active until the end of the paid period.</p>
        <h3>Failed or duplicate payments</h3>
        <p>If you were charged but Pro was not activated, or you were charged twice, contact us and we will activate or refund within 5 to 7 business days. Refunds go back to the original payment method through Razorpay.</p>
      </>
    ),
  },
  contact: {
    title: "Contact",
    body: (
      <>
        <p>For support, billing, refunds or data requests, <a href="/app#feedback">sign in and open Feedback</a>. Your submission and our reply stay private to your account. Check Your submissions for updates.</p>
        {SUPPORT_EMAIL && <p>You can also email {mail}.</p>}
        <p>Having trouble signing in? <a href="https://github.com/bhaskarjgoswami/TradeDesk/issues/new" target="_blank" rel="noreferrer">Report a technical issue</a>. GitHub issues are public: never include passwords, API keys, payment IDs, or journal data there.</p>
        <p>For payment issues, include your Razorpay payment ID in private Feedback. Never share card details or passwords.</p>
      </>
    ),
  },
};

export const LEGAL_PAGES = Object.keys(PAGES); // keep in sync with App.jsx LEGAL_PAGES

export default function Legal({ page }) {
  const language=useSyncExternalStore(listener=>window.TDLocale?.subscribe(listener)||(()=>{}),()=>window.TDLocale?.language||'en',()=> 'en');
  const updated=new Intl.DateTimeFormat(language,{dateStyle:'long',timeZone:'UTC'}).format(new Date(LEGAL_UPDATED+'T00:00:00Z'));
  const p = PAGES[page];
  if (!p) return <Navigate to="/" replace />;
  return (
    <div className="pub">
      <PublicHeader />
      <main className="pub-legal">
        <h1>{p.title}</h1>
        {p.body}
        <p className="muted">Last updated {updated}</p>
      </main>
      <PublicFooter />
    </div>
  );
}
