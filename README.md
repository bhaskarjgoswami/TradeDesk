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
| Pro | ₹199/mo (India) · $9/mo (intl) | Unlimited trades |

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

## Local journal

The local-only Python + SQLite journal lives at the repo root. See `LOCAL-JOURNAL.md`.
