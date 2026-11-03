import { Navigate } from "react-router-dom";
import { BRAND, SUPPORT_EMAIL, LEGAL_UPDATED } from "../lib/brand";
import { PublicHeader, PublicFooter } from "./Landing";

const mail = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;

const PAGES = {
  terms: {
    title: "Terms of Service",
    body: (
      <>
        <p>These terms govern your use of {BRAND}, a trading journal web application. By creating an account you agree to them.</p>
        <h3>The service</h3>
        <p>{BRAND} lets you record trades, journal notes and screenshots, and import trade fills from supported exchanges using read-only API keys you provide. {BRAND} never places orders on your behalf.</p>
        <h3>Not financial advice</h3>
        <p>Statistics, charts and any other output are records of your own data. Nothing in {BRAND} is investment, trading or tax advice. Trading carries risk of loss and you are solely responsible for your decisions.</p>
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
        <p>This policy explains what {BRAND} collects and how it is used.</p>
        <h3>What we store</h3>
        <ul>
          <li>Account: email address and an encrypted password (managed by Supabase Auth).</li>
          <li>Journal data you enter or import: trades, notes, checklist, preferences and chart screenshots.</li>
          <li>Exchange API keys you save, encrypted by the application before storage.</li>
          <li>Plan status and payment reference IDs. Card and UPI details are handled by Razorpay and never reach us.</li>
        </ul>
        <h3>How we use it</h3>
        <p>Only to provide the service: show your journal, compute your statistics, import your fills and manage your plan. We do not sell your data or use it for advertising.</p>
        <h3>Where it lives</h3>
        <p>Data is stored with Supabase (database, authentication, private file storage). The application runs on Render and Vercel. Payments are processed by Razorpay. Screenshots are private and served through short-lived signed links.</p>
        <h3>Your rights</h3>
        <p>In Settings → Your data you can download all your data or permanently delete your account, which removes your trades, journal, screenshots and profile. You can also email {mail}.</p>
        <h3>Retention</h3>
        <p>We keep your data while your account exists. Deleting your account removes it from our systems; backups age out within 30 days.</p>
        <p>Contact: {mail}</p>
      </>
    ),
  },
  refunds: {
    title: "Refund & Cancellation Policy",
    body: (
      <>
        <p>Pro is a one-time payment for a fixed period. There is no subscription to cancel and nothing renews automatically.</p>
        <h3>Refunds</h3>
        <p>If Pro does not work for you, email {mail} within 7 days of payment with your registered email and Razorpay payment ID for a full refund. After 7 days, payments are non-refundable, and Pro stays active until the end of the paid period.</p>
        <h3>Failed or duplicate payments</h3>
        <p>If you were charged but Pro was not activated, or you were charged twice, contact us and we will activate or refund within 5 to 7 business days. Refunds go back to the original payment method through Razorpay.</p>
      </>
    ),
  },
  contact: {
    title: "Contact",
    body: (
      <>
        <p>For support, billing, refunds or data requests, email {mail}.</p>
        <p>Please include the email you signed up with. For payment issues, also include your Razorpay payment ID.</p>
      </>
    ),
  },
};

export const LEGAL_PAGES = Object.keys(PAGES);

export default function Legal({ page }) {
  const p = PAGES[page];
  if (!p) return <Navigate to="/" replace />;
  return (
    <div className="pub">
      <PublicHeader />
      <main className="pub-legal">
        <h1>{p.title}</h1>
        {p.body}
        <p className="muted">Last updated {LEGAL_UPDATED}</p>
      </main>
      <PublicFooter />
    </div>
  );
}
