# TradeDesk

A full-stack trade journaling SaaS for serious traders — web + mobile, powered by Supabase and Delta Exchange.

## Structure

```
tradedesk/
├── backend/        FastAPI — REST API, auth, Delta integration, Stripe
├── frontend/       React + Vite — web app
├── mobile/         React Native (Expo) — iOS + Android
├── supabase/       DB schema, migrations, RLS policies
└── legacy/         Original standalone Python app (reference only)
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
| Payments | Stripe |
| Hosting | Railway (backend) · Vercel (frontend) |

## Subscription Tiers

| Plan | Price | Limits |
|---|---|---|
| Free | $0 | 50 trades/month, no Delta sync, no mobile |
| Pro | $9/mo | Unlimited trades, Delta sync, mobile app, screenshot uploads |

## Local dev (backend)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in Supabase + Stripe keys
uvicorn app.main:app --reload --port 8787
```

## Environment variables

See `backend/.env.example` for the full list.

## Legacy app

The original local-only `app.py` is in `legacy/` — zero dependencies,
still works standalone on `python3 legacy/app.py`.
