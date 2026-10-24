-- RunNotes: "Use your own project" workspaces.
-- Each visitor workspace is a random UUID kept in their browser. Entries and insights are
-- stored under it, separate from the owner's journal (workspace = 'owner').
-- No API keys are stored anywhere: they stay in the visitor's browser tab.
-- Run once in the Supabase SQL editor, after 004_rate_limits.sql.

create table if not exists public.workspaces (
  id                          uuid primary key,
  wandb_entity                text not null,
  wandb_project               text not null,
  primary_metric              text not null,       -- e.g. 'val_loss'
  primary_higher_is_better    boolean not null,
  secondary_metric            text,                -- optional second column
  secondary_higher_is_better  boolean,
  created_at                  timestamptz not null default now(),
  last_seen_at                timestamptz not null default now()
);
alter table public.workspaces enable row level security;

-- Existing rows belong to the owner's journal.
alter table public.entries add column if not exists workspace text not null default 'owner';
alter table public.entries drop constraint if exists entries_run_id_key;
alter table public.entries add constraint entries_workspace_run_id_key unique (workspace, run_id);
create index if not exists entries_workspace_idx on public.entries (workspace);

alter table public.insights add column if not exists workspace text not null default 'owner';
create index if not exists insights_workspace_created_idx on public.insights (workspace, created_at desc);
