CREATE TABLE IF NOT EXISTS public.api_rate_buckets (
 user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
 action text NOT NULL,
 bucket bigint NOT NULL,
 hits integer NOT NULL DEFAULT 1,
 PRIMARY KEY(user_id,action,bucket)
);
ALTER TABLE public.api_rate_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_buckets FROM anon,authenticated;
CREATE INDEX IF NOT EXISTS api_rate_expiry ON public.api_rate_buckets(bucket);
