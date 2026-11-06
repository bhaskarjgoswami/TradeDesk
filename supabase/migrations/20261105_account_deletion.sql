ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS deletion_started_at timestamptz;
