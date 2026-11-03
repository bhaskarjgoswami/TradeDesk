-- ============================================================
--  2026-11-03 audit fixes (idempotent)
-- ============================================================

-- 1. Billing columns (were never applied to the live DB, so active_tier() crashed)
alter table public.user_profiles add column if not exists subscription_plan       text;
alter table public.user_profiles add column if not exists subscription_expires_at timestamptz;
alter table public.user_profiles add column if not exists razorpay_payment_id      text;
alter table public.user_profiles add column if not exists exchange_creds           jsonb;

-- 2. Lock down direct table access. The web app talks only to the FastAPI
--    backend (which connects as the table owner and bypasses RLS); Supabase
--    is used from the browser for auth only. Without this, any signed-in user
--    could PATCH their own profile to subscription_tier='pro' via the REST API
--    with the public anon key, or insert trades past the free limit.
revoke all on public.user_profiles from anon, authenticated;
revoke all on public.trades        from anon, authenticated;
revoke all on public.day_logs      from anon, authenticated;

drop policy if exists "users: own profile" on public.user_profiles;
drop policy if exists "trades: own rows"   on public.trades;
drop policy if exists "daylogs: own rows"  on public.day_logs;
-- RLS stays enabled with no policies = deny-all for API roles (defence in depth).

-- 3. Screenshot storage bucket (private; backend uploads with the service role
--    and hands out short-lived signed URLs). 5 MB cap, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trade-images', 'trade-images', false, 5242880,
        array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do nothing;

-- 4. Exchange import dedupe key (one row per Delta round-trip)
alter table public.trades add column if not exists ext_id text;
create unique index if not exists trades_user_ext_id
  on public.trades(user_id, ext_id) where ext_id is not null;

-- 5. Post-trade review (followed plan, quality, emotions, mistakes)
alter table public.trades add column if not exists review jsonb;
