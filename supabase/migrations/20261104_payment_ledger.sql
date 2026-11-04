-- Server-owned orders and an immutable grant ledger prevent payment replay.
CREATE TABLE IF NOT EXISTS public.billing_orders (
 id text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
 plan text NOT NULL CHECK (plan IN ('monthly','annual')),
 currency text NOT NULL CHECK (currency IN ('INR','USD')),
 amount integer NOT NULL CHECK (amount > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.billing_payments (
 payment_id text PRIMARY KEY,
 order_id text NOT NULL UNIQUE REFERENCES public.billing_orders(id),
 user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
 granted_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_orders, public.billing_payments FROM anon, authenticated;
