CREATE TABLE IF NOT EXISTS public.feedback_triage (
    user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    item_id bigint NOT NULL,
    status text NOT NULL CHECK (status IN ('open','triaged','closed')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,item_id)
);
ALTER TABLE public.feedback_triage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feedback_triage FROM anon,authenticated;

ALTER TABLE public.feedback_triage ADD COLUMN IF NOT EXISTS reply text NOT NULL DEFAULT '';
