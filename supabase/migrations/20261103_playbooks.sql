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
