# TradeDesk

TradeDesk is a web trade journal with a shared desktop/web interface, Supabase cloud accounts, broker CSV imports, an optional Delta Exchange connector, and Razorpay period purchases. Native mobile apps are planned; `mobile/` is a placeholder.

## Structure

```
tradedesk/
├── backend/        FastAPI — REST API, auth, Delta integration, Razorpay
├── frontend/       React + Vite — web app
├── mobile/         Placeholder — native apps are not implemented
├── supabase/       DB schema, migrations, RLS policies
```

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI (Python) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (JWT) |
| Storage | Supabase Storage (trade screenshots) |
| Web | React + Vite |
| Mobile | Responsive web; native apps planned |
| Payments | Razorpay |
| Hosting | Render (backend) · Vercel (frontend) |

## Subscription Tiers

| Plan | Price | Limits |
|---|---|---|
| Free | $0 / ₹0 | 2 trade entries/day, broker CSV imports, screenshots |
| Pro | USD $9/month or $90/year · INR ₹99/month or ₹699/year | Unlimited trades |

## Local dev (backend)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in Supabase + Razorpay keys
uvicorn app.main:app --reload --port 8787
```

## Environment variables

See `backend/.env.example` for the full list.

## Journal interface and deployment

The repo-root HTML, JavaScript and CSS are the shared journal interface. The
local launcher serves them with Python + SQLite. The web build copies the same
files into `frontend/app/` and `frontend/public/`, then connects them to the
signed-in user's cloud API at `/j/api/*`. Vercel opens the journal at `/app`
when visiting `/`. Local SQLite records are not uploaded by a deployment.

After editing the root interface, run `npm run sync:journal` in `frontend/` and
commit the generated copies. CI checks they match; `npm run build` also syncs
them automatically. Push explicitly with `git push bjg main` to `bhaskarjgoswami/TradeDesk`.
Wait for both CI jobs, including disposable PostgreSQL tests, to pass before
promoting that exact commit to production. Apply any new SQL migrations first.
Render is configured to wait for CI checks; verify the deployed commit after
each release. Avoid overlapping manual and automatic frontend releases.

See `LOCAL-JOURNAL.md` for the local Python + SQLite launcher and backups.

## Production operations

`/health` is process liveness; `/ready` verifies the database and required billing tables. Configure the Render health check and external uptime monitor to use `/ready`. Configure failure notifications for the GitHub Uptime workflow and add `SENTRY_DSN` to Render for error reports (PII disabled).

The current Free Render plan can sleep. A paid always-on instance, an isolated staging Supabase project/backend, provider backup retention, a real Razorpay capture/refund drill, and signed-in browser/mobile checks remain launch requirements until verified. Never point disposable PostgreSQL tests at customer databases.

Before a release, run backend tests, frontend tests/build and `check:journal`; apply additive migrations; deploy the exact passing commit; verify readiness, sign-in, a journal write, billing and screenshots. On failure, roll back application code to the last passing commit. Review migration compatibility before attempting any schema rollback; do not delete customer data.

Before accepting paid customers, assign the project owner responsibility for incident response, Razorpay refunds, support email delivery and database/storage backup retention. Restore a journal backup in a disposable account and verify screenshots. Never store broker secrets in user exports or logs.

## Razorpay Standard Checkout

The existing FastAPI integration uses authenticated endpoints `POST /api/subscription/checkout` and `POST /api/subscription/verify`, with the React checkout on `/billing`. The existing HTTP client calls Razorpay directly; a second SDK/integration is not needed.

Install `backend/requirements.txt`, then configure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the ignored `backend/.env` for local use and in Render Environment for hosting. Never add the secret to a `VITE_` variable. The server returns only the public Key ID with the order.

Checkout accepts `{plan: "monthly" | "annual", currency: "INR" | "USD", amount?: integer, receipt?: string}`. The server determines the price: INR ₹99 monthly / ₹699 annually, or USD $9 monthly / $90 annually. If an amount is supplied, it must be at least 100 minor units and exactly match the selected server price; receipts contain 1–40 characters and are generated when omitted. Orders are stored in the existing billing ledger.

Verification accepts `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature`. HMAC verification is followed by server-side ownership, amount, currency and captured-payment checks before Pro is granted. Invalid or missing signatures return 400. Provider authentication failures return 401 with a provider-specific error code; other provider errors return 500. Existing unique payment/order records prevent replay.

To test locally, start the backend with `uvicorn app.main:app --reload --port 8787`, configure the frontend public Supabase/API settings for the same environment, run `npm run dev` in `frontend`, sign in, open `/billing`, select a period, and click Get Pro. With test keys, a Test Mode notice appears. Use Razorpay's documented test-payment flow; confirm Pro only activates after verification. Also dismiss checkout and test a failed payment. No real money is collected in Test Mode.

Test Mode works through the signed browser callback without a webhook. Before live checkout is enabled, configure `RAZORPAY_WEBHOOK_SECRET` and an `order.paid` webhook at `https://tradedesk-nopw.onrender.com/api/subscription/webhook`, enable automatic capture in Razorpay, complete merchant activation, and replace the test credentials with Live credentials. Live checkout remains disabled until its webhook secret is configured. Access periods are one-time purchases, without automatic renewal.

## Global journal and broker imports

TradeDesk is a journal for traders worldwide. Billing and new journal currency selections offer USD and INR. India-timezone visitors initially see INR, other visitors see USD, and billing currency can be switched and is remembered on the device. Annual is the initial purchase period. Active Pro members see a disabled Current plan action; the Free action is disabled.

Use Settings → Data → Import broker CSV for exports from other brokers. Map the broker's columns, explicitly choose the date and decimal format, review position direction, select gross/net P&L and fee conventions, then review the preview before importing. Comma, semicolon and tab separators are supported. Buy/Sell direction conversion is opt-in. Net P&L is normalized to gross with fees recorded separately, preserving the original net result. Broker labels are saved in tags. Files must contain trade/position records; individual fills need to be combined first. Imports retain existing validation, duplicate detection and Free daily quotas.

New journals can choose their base currency before recording trades. Existing trade amounts are never relabeled by changing base currency; display currency converts for viewing. Older saved currencies remain readable. Delta is the optional direct API connector currently implemented; other brokers use the CSV mapping flow or manual entry. International card acceptance requires the merchant's payment-provider international-payments activation before going live.

## Trade save contract

The journal editor requires an explicit units-per-lot/contract value for automatic P&L and risk calculations on an unknown instrument. Use 1 for actual shares/units; use the instrument contract size when quantity is entered as lots. Broker-entered P&L can be recorded directly.

Manual creates send a stable `clientId` for the save intent. A replay returns the original trade; reusing that ID with changed fields is rejected. Full edits send `expectedRevision`; conflicting edits return 409 and retain the editor values. Review edits also increment the trade revision. Additive per-journal columns and indexes are provisioned by `workspace.init`; existing data is retained. A completed write remains saved if a later list refresh fails.

Journal timestamps use the selected IANA timezone (saved profile, or the browser zone sent by the editor) and are stored in UTC when a clock is known. Date-only entries stay date-only. Ambiguous or nonexistent daylight-saving clocks require an explicit UTC time or an omitted clock; they are not guessed. Delta pull and sync share stable broker references and rebuild closed positions across days. Sync rejects an incomplete history window rather than announcing that partial data is up to date. Broker contract metadata failures are retryable and never cached as a multiplier of 1.

Unsaved journal edits are recovered from account-scoped session storage in the current browser tab. Signing out clears these drafts. Pending saves retain their original request identity across reloads; later edits are applied only after the pending request is acknowledged. The offline shell caches public UI assets only; journal API responses and private images are never cached by the service worker. Creating, syncing, and saving trades requires a connection. Legacy Settings and Subscription links redirect into the journal shell.

CSV imports require a positive contract multiplier to calculate P&L from price and quantity. Broker P&L remains authoritative when supplied. A mapped closed-trade ID is namespaced by broker and distinguishes identical executions. Without IDs, immutable financial fields form the duplicate key; notes and tags do not create new trades. Identical executions without IDs cannot be distinguished: provide IDs before importing those files. Outcome badges and filters use P&L after total fees.

ZIP restores validate all item types, settings, routine progress, dates, JSON shapes, IDs, revisions, columns, and referenced images before any upload or database write. Transient pretrade checklist state is reset. Restore is available only in an empty journal.

Operator workflow (run from `backend` with server-only environment variables):
- `.venv/bin/python scripts/operations.py feedback --summary` gives queue counts; omit `--summary` to review the latest messages and attachment paths locally.
- `.venv/bin/python scripts/operations.py triage --user <UUID> --id <ID> --status triaged` records review; use `closed` after resolution. The queue is private to operators and never grants browser users staff access. The project maintainer should review it daily; availability failures appear in the GitHub Production availability workflow. Configure GitHub notifications for its failures.
- `.venv/bin/python scripts/operations.py metrics` reports first-trade activation, onboarding completion, seven-day trading activity, and week-one retention. Retention counts a trade logged at account age 7–14 days, using only accounts at least 14 days old; accounts with no journal stay in the denominator. It uses existing records, so deleting trades also removes their contribution. No external analytics service or new browser tracking is installed.

Images share an account-wide budget of 100 MB on Free and 1 GB on active Pro, in addition to the 5 MB file limit. Concurrent uploads and restores serialize budget checks. Existing images remain readable after downgrading; new uploads require sufficient room.

Account deletion commits a durable pending state before removing anything. Normal API access and media credentials are blocked, in-flight journal operations finish before cleanup begins, and retries resume the same removal. A failed cleanup displays a recovery action. Apply `20261105_account_deletion.sql` and `20261105_feedback_triage.sql` before deploying this release.

Server failures return an `X-Request-ID` for investigation. Structured request logs omit user IDs, raw URLs, query strings, bodies and exception messages. Optional Sentry reporting disables body capture, breadcrumbs, local variables, and tracing; its final event scrubber retains only error classes and code locations. Production Sentry DSN and alert delivery still need provider configuration.

Support now defaults to `/contact` rather than an unconfigured email address. Customers submit private Feedback and read operator replies in Your submissions. Operators use `triage --reply-file <UTF-8-file>` to reply without sending email; messages are rendered as text. For public sign-in problems the contact page links to GitHub with an explicit warning against posting private data. Set `VITE_SUPPORT_EMAIL` only after verifying the mailbox.

Settings → Journal shows image usage and can reclaim at most 100 unreferenced files older than seven days per request. Reclamation holds account storage and journal write locks, excludes legacy references, and requires user confirmation because an old unsaved draft may refer to an unattached image.

Readiness also checks the billing payment ledger, feedback triage/reply schema and account deletion marker. A release with missing migrations returns 503 rather than advertising a healthy service. Legacy trade writes recheck the account after acquiring the storage lock, so a request authenticated before deletion cannot resume writing after deletion starts.

For a repeatable local load baseline, initialize a disposable PostgreSQL database named `tradedesk_test`, run the backend tests against it, then run from the repository root:

```sh
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/tradedesk_test backend/.venv/bin/python backend/scripts/load_baseline.py
```

The script rejects non-local databases, creates and removes its own test account, seeds 10,000 trades, and measures 100 requests with eight workers (80% paginated reads and 20% writes). On 6 November 2026 it recorded zero errors, a 146.55 ms median and a 172.26 ms p95. These are local application measurements; hosted staging, production network latency, browser rendering and a production capacity target still require validation.

`npm run check:translations` in `frontend/` audits visible static copy and common dynamic messages in the shared journal, public/legal pages and billing. It excludes named products, brokers and instrument identifiers. The frontend tests run this check for all seven non-English catalogs, validate matching keys, and exercise count/name interpolation without changing user content or submitted values. Translation drafts were generated from public interface copy with Google Translate; navigation and common count messages received additional review. This does not establish native-speaker or legal-translation sign-off.

The mobile drawer removes hidden navigation from keyboard access, contains focus while open, supports Escape and a close button, and restores background access when resized to desktop. DOM tests cover these behaviors and RTL settings-tab navigation. Responsive CSS accounts for dynamic viewport height, safe-area padding, long translated labels and mobile input text sizing. Actual device screenshots, touch behavior, browser accessibility trees and native RTL layout still require a connected browser/device for acceptance.
