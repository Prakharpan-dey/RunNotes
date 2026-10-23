-- RunNotes: cross-run insights. Every regeneration adds a row; the page shows the newest,
-- so earlier versions are kept. Run once in the Supabase SQL editor.

create table if not exists public.insights (
  id              uuid primary key default gen_random_uuid(),
  project         text not null,                -- W&B project, e.g. 'shl-grammar'
  insights        jsonb not null,               -- headline, insights[], next_experiment, plus W&B evidence
  after_run       int,                          -- run number whose entry triggered this version
  trigger_run_id  text,                         -- W&B run id of that run
  entry_count     int not null,                 -- how many entries it was built from
  created_at      timestamptz not null default now()
);

create index if not exists insights_project_created_idx on public.insights (project, created_at desc);

-- Server-only, like entries: the service role key bypasses RLS, the anon key gets nothing.
alter table public.insights enable row level security;
