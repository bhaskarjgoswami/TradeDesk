# TradeDesk

TradeDesk is a web trade journal with a shared desktop/web interface, Supabase cloud accounts, Delta Exchange imports, and Razorpay period purchases. Native mobile apps are planned; `mobile/` is a placeholder.

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
| Free | $0 | 2 trades/day, Delta sync, screenshot uploads |
| Pro | ₹99/month or ₹699/year (India) · $9/month or $90/year (intl) | Unlimited trades |

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
