-- ============================================================
--  TradeDesk — Supabase schema
--  Run this in Supabase → SQL Editor → New query
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── user_profiles ────────────────────────────────────────────
-- One row per auth.users entry. Created automatically via trigger.
create table if not exists public.user_profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text,
  subscription_tier    text not null default 'free', -- 'free' | 'pro'
  stripe_customer_id   text,
  delta_key            text,          -- per-user Delta API key (encrypted by Postgres at-rest)
  delta_secret         text,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

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
  created_at   timestamptz default now()
);

create index if not exists trades_user_date on trades(user_id, date);


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

-- user_profiles: own row only
create policy "users: own profile"
  on public.user_profiles for all
  using (auth.uid() = id);

-- trades: own rows only
create policy "trades: own rows"
  on public.trades for all
  using (auth.uid() = user_id);

-- day_logs: own rows only
create policy "daylogs: own rows"
  on public.day_logs for all
  using (auth.uid() = user_id);


-- ============================================================
--  Storage bucket — trade-images
--  Run separately in Supabase Dashboard → Storage → New bucket
--  OR use the SQL below (requires storage schema access)
-- ============================================================

-- insert into storage.buckets (id, name, public)
-- values ('trade-images', 'trade-images', false)
-- on conflict do nothing;

-- -- Users can only read/write their own folder (user_id/filename)
-- create policy "trade-images: upload own"
--   on storage.objects for insert
--   with check (bucket_id = 'trade-images' and auth.uid()::text = (storage.foldername(name))[1]);

-- create policy "trade-images: read own"
--   on storage.objects for select
--   using (bucket_id = 'trade-images' and auth.uid()::text = (storage.foldername(name))[1]);

-- create policy "trade-images: delete own"
--   on storage.objects for delete
--   using (bucket_id = 'trade-images' and auth.uid()::text = (storage.foldername(name))[1]);
