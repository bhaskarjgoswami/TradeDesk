CREATE TABLE IF NOT EXISTS public.api_rate_windows (
 user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
 action text NOT NULL,
 window bigint NOT NULL,
 hits integer NOT NULL DEFAULT 1,
 PRIMARY KEY(user_id,action,window)
);
ALTER TABLE public.api_rate_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_windows FROM anon,authenticated;
CREATE INDEX IF NOT EXISTS api_rate_expiry ON public.api_rate_windows(window);
