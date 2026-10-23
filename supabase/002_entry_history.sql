-- RunNotes: keep every earlier version of an entry when it's fixed by voice.
-- Run once in the Supabase SQL editor, after entries.sql.

alter table public.entries
  add column if not exists history    jsonb not null default '[]'::jsonb,  -- earlier versions, oldest first
  add column if not exists updated_at timestamptz;                          -- set when a fix is applied

-- Each history item looks like:
-- { "raw_notes": "...", "entry": {...}, "saved_at": "...", "replaced_at": "...", "correction": "what you said to fix it" }
