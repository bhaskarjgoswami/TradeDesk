# TradeDesk

A full-stack trade journaling SaaS for serious traders — web + mobile, powered by Supabase and Delta Exchange.

## Structure

```
tradedesk/
├── backend/        FastAPI — REST API, auth, Delta integration, Razorpay
├── frontend/       React + Vite — web app
├── mobile/         React Native (Expo) — iOS + Android
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
| Mobile | React Native (Expo) |
| Payments | Razorpay |
| Hosting | Render (backend) · Vercel (frontend) |

## Subscription Tiers

| Plan | Price | Limits |
|---|---|---|
| Free | $0 | 2 trades/day, Delta sync, screenshot uploads |
| Pro | ₹99/mo (India) · $9/mo (intl) | Unlimited trades |

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
them automatically. Push `main` to `bhaskarjgoswami/TradeDesk` to update the
connected Vercel frontend and Render backend.

See `LOCAL-JOURNAL.md` for the local Python + SQLite launcher and backups.
