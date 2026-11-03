-- ============================================================
--  TradeDesk — Supabase schema
--  Run this in Supabase → SQL Editor → New query
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── user_profiles ────────────────────────────────────────────
-- One row per auth.users entry. Created automatically via trigger.
create table if not exists public.user_profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  email                    text,
  subscription_tier        text not null default 'free', -- 'free' | 'pro'
  subscription_plan        text,          -- 'monthly' | 'annual'
  subscription_expires_at  timestamptz,   -- Pro is active while this is in the future
  razorpay_payment_id      text,          -- last applied payment (idempotency)
  stripe_customer_id       text,          -- legacy (Stripe), kept for back-compat
  delta_key                text,          -- per-user Delta API key (encrypted by Postgres at-rest)
  delta_secret             text,
  exchange_creds           jsonb,         -- {exchange: {key,secret,passphrase}}, app-encrypted (secretbox.py)
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- Idempotent migration for databases created before Razorpay billing landed.
alter table public.user_profiles add column if not exists subscription_plan       text;
alter table public.user_profiles add column if not exists subscription_expires_at timestamptz;
alter table public.user_profiles add column if not exists razorpay_payment_id      text;
alter table public.user_profiles add column if not exists exchange_creds           jsonb;

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ── trades ───────────────────────────────────────────────────
create table if not exists public.trades (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         text,
  symbol       text,
  direction    text,                -- 'Long' | 'Short'
  setup        text,
  tf_bias      text,
  logic        text,
  entry        numeric,
  stop         numeric,
  exit         numeric,
  qty          numeric,
  risk         numeric,
  pnl          numeric,
  r_multiple   numeric,
  outcome      text,                -- 'Win' | 'Loss' | 'BE'
  rating       int,                 -- 1–5
  tags         text,
  notes        text,
  images       text,                -- JSON array of Supabase Storage paths
  checklist    text,
  fee          numeric,
  ext_id       text,                -- exchange round-trip id (import dedupe)
  created_at   timestamptz default now()
);

alter table public.trades add column if not exists ext_id text;
alter table public.trades add column if not exists review jsonb;  -- post-trade review
create index if not exists trades_user_date on trades(user_id, date);
create unique index if not exists trades_user_ext_id on trades(user_id, ext_id) where ext_id is not null;


-- ── day_logs ─────────────────────────────────────────────────
create table if not exists public.day_logs (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          text not null,
  market        text,
  watchlist     text,
  mistakes      text,
  did_great     text,
  reinforcement text,
  overall       text,
  tags          text,
  checklist     text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(user_id, date)
);

create index if not exists daylogs_user_date on day_logs(user_id, date);


-- ============================================================
--  Row Level Security
-- ============================================================

alter table public.user_profiles enable row level security;
alter table public.trades        enable row level security;
alter table public.day_logs      enable row level security;

-- No policies on purpose: the browser uses Supabase for auth only and all
-- data goes through the FastAPI backend (table owner, bypasses RLS). RLS with
-- no policies + revoked grants = the public anon key cannot read or write
-- these tables (otherwise users could PATCH themselves to Pro).
revoke all on public.user_profiles from anon, authenticated;
revoke all on public.trades        from anon, authenticated;
revoke all on public.day_logs      from anon, authenticated;


-- ============================================================
--  Storage bucket — trade-images (private; backend uploads with the
--  service role and serves short-lived signed URLs)
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trade-images', 'trade-images', false, 5242880,
        array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do nothing;
-- Playbooks: a trader's strategies, each with its own pre-trade checklist.
create table if not exists public.playbooks (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  description  text,
  checklist    jsonb not null default '[]'::jsonb,  -- array of criteria strings
  exit_rules   text,
  management   text,
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists playbooks_user on public.playbooks(user_id);

-- Backend-only access, like the other tables (RLS on, no policies, no grants).
alter table public.playbooks enable row level security;
revoke all on public.playbooks from anon, authenticated;
revoke all on sequence public.playbooks_id_seq from anon, authenticated;

-- Link trades to the playbook they were taken under.
alter table public.trades add column if not exists playbook_id bigint
  references public.playbooks(id) on delete set null;
create index if not exists trades_playbook on public.trades(playbook_id) where playbook_id is not null;
