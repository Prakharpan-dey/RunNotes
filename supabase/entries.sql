-- RunNotes: one journal entry per W&B run.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Then run 002_entry_history.sql.

create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  run_id      text not null unique,          -- W&B run id, e.g. 'kjn6gh63'
  raw_notes   text not null,                 -- what you said, exactly as Flow typed it
  entry       jsonb not null,                -- structured entry + metrics taken from W&B
  created_at  timestamptz not null default now()
);

create index if not exists entries_created_at_idx on public.entries (created_at desc);

-- Lock the table to the server. The app uses the service role key, which bypasses RLS;
-- with RLS on and no policies, the public anon key can't read or write entries.
alter table public.entries enable row level security;
