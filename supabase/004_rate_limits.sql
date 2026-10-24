-- RunNotes: rate limits for the public demo and the owner passcode form.
-- One row per (bucket, hashed IP); a fixed window that resets once it has passed.
-- Run once in the Supabase SQL editor.

create table if not exists public.rate_limits (
  bucket        text not null,                       -- e.g. 'demo-entry', 'owner-login'
  key           text not null,                       -- sha256 of the visitor's IP, never the raw IP
  window_start  timestamptz not null default now(),
  count         int not null default 0,
  primary key (bucket, key)
);

-- Server-only, like the other tables.
alter table public.rate_limits enable row level security;

-- Counts one hit and says whether it's allowed, in a single atomic statement,
-- so two requests at the same moment can't both slip under the limit.
create or replace function public.hit_rate_limit(
  p_bucket text,
  p_key text,
  p_limit int,
  p_window_seconds int
)
returns table (allowed boolean, hits int, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rate_limits;
begin
  insert into public.rate_limits as rl (bucket, key, window_start, count)
  values (p_bucket, p_key, now(), 1)
  on conflict (bucket, key) do update
    set count = case
          when rl.window_start <= now() - make_interval(secs => p_window_seconds) then 1
          else rl.count + 1
        end,
        window_start = case
          when rl.window_start <= now() - make_interval(secs => p_window_seconds) then now()
          else rl.window_start
        end
  returning * into r;

  return query
    select r.count <= p_limit, r.count, r.window_start + make_interval(secs => p_window_seconds);
end;
$$;

-- Only the server (service role) may call it.
revoke all on function public.hit_rate_limit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, text, int, int) to service_role;
