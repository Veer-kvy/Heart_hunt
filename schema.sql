-- =====================================================================
-- HEART HUNT - INFINITY MODE online leaderboard (Supabase / Postgres)
-- Run this once in: Supabase Dashboard > SQL Editor.
-- Also enable: Authentication > Sign In / Providers > "Allow anonymous sign-ins".
-- =====================================================================

-- ---------- table ----------
create table if not exists public.infinity_scores (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid    not null unique,                 -- client-generated per run: makes retries idempotent
  user_id        uuid    not null references auth.users(id) on delete cascade,
  player_name    text    not null check (player_name ~ '^[A-Za-z0-9 _.-]{1,12}$'),
  score          integer not null check (score between 0 and 100000),
  highest_combo  integer not null check (highest_combo between 0 and 9999),
  hearts         integer not null check (hearts between 0 and 100000),
  duration_ms    integer not null check (duration_ms between 0 and 86400000),
  created_at     timestamptz not null default now(),     -- server time; the client never sends it
  check (highest_combo <= hearts)
);

create index if not exists infinity_scores_rank_idx   on public.infinity_scores (score desc, highest_combo desc, created_at asc);
create index if not exists infinity_scores_user_idx   on public.infinity_scores (user_id, score desc);
create index if not exists infinity_scores_recent_idx on public.infinity_scores (created_at desc);

-- ---------- Row Level Security ----------
-- RLS on, and NO policies: the browser cannot select/insert/update/delete rows directly.
-- All access goes through the SECURITY DEFINER functions below.
alter table public.infinity_scores enable row level security;
revoke all on public.infinity_scores from anon, authenticated;

-- ---------- submit (server-side validation + rate limits) ----------
create or replace function public.submit_infinity_score(
  p_run_id uuid, p_name text, p_score integer, p_combo integer, p_hearts integer, p_duration_ms integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid     uuid := auth.uid();
  v_name  text;
  secs    numeric;
  my_best integer;
  rk      integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_run_id is null or p_name is null or p_score is null or p_combo is null
     or p_hearts is null or p_duration_ms is null then
    raise exception 'malformed payload' using errcode = '22023';
  end if;

  -- idempotent retry: same run already stored -> return its rank, no new row, no rate-limit hit
  if exists (select 1 from public.infinity_scores where run_id = p_run_id and user_id = uid) then
    select max(score) into my_best from public.infinity_scores where user_id = uid;
    select 1 + count(*) into rk from (select max(score) b from public.infinity_scores group by user_id) t where t.b > my_best;
    return jsonb_build_object('accepted', true, 'rank', rk, 'duplicate', true);
  end if;

  v_name := btrim(regexp_replace(p_name, '\s+', ' ', 'g'));
  if v_name !~ '^[A-Za-z0-9 _.-]{1,12}$' then
    raise exception 'invalid nickname' using errcode = '22023';
  end if;
  if p_score < 0 or p_score > 100000 or p_combo < 0 or p_combo > 9999
     or p_hearts < 0 or p_hearts > 100000 or p_duration_ms < 0 or p_duration_ms > 86400000 then
    raise exception 'value out of range' using errcode = '22003';
  end if;

  -- plausibility checks. These are HEURISTICS on client-reported numbers, not proof (see README).
  secs := greatest(p_duration_ms, 1) / 1000.0;
  if p_score > 0 and p_duration_ms < 3000 then raise exception 'run too short' using errcode = '22023'; end if;
  if p_score  > 20 * secs + 30 then raise exception 'implausible score'  using errcode = '22023'; end if;
  if p_hearts > 10 * secs + 10 then raise exception 'implausible hearts' using errcode = '22023'; end if;
  if p_combo  > p_hearts       then raise exception 'implausible combo'  using errcode = '22023'; end if;

  -- rate limits per player: 1 submission / 20 s and 100 / day
  if exists (select 1 from public.infinity_scores where user_id = uid and created_at > now() - interval '20 seconds') then
    raise exception 'rate limited' using errcode = '54000';
  end if;
  if (select count(*) from public.infinity_scores where user_id = uid and created_at > now() - interval '1 day') >= 100 then
    raise exception 'daily limit reached' using errcode = '54000';
  end if;

  insert into public.infinity_scores (run_id, user_id, player_name, score, highest_combo, hearts, duration_ms)
  values (p_run_id, uid, v_name, p_score, p_combo, p_hearts, p_duration_ms)
  on conflict (run_id) do nothing;

  select max(score) into my_best from public.infinity_scores where user_id = uid;
  select 1 + count(*) into rk from (select max(score) b from public.infinity_scores group by user_id) t where t.b > my_best;
  return jsonb_build_object('accepted', true, 'rank', rk);
end $$;

-- ---------- read: global top (best run per player) ----------
create or replace function public.get_infinity_leaderboard(p_limit integer default 100)
returns table (rank bigint, player_name text, score integer, highest_combo integer, created_at timestamptz, is_mine boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  with best as (
    select distinct on (user_id) user_id, player_name, score, highest_combo, created_at
    from public.infinity_scores
    order by user_id, score desc, highest_combo desc, created_at asc
  ), ranked as (
    select row_number() over (order by score desc, highest_combo desc, created_at asc) as rank,
           player_name, score, highest_combo, created_at, (user_id = auth.uid()) as is_mine
    from best
  )
  select rank, player_name, score, highest_combo, created_at, coalesce(is_mine, false)
  from ranked order by rank limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

-- ---------- read: the caller's own best + rank ----------
create or replace function public.get_my_infinity_stats()
returns table (best integer, rank bigint, runs bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  with mine as (select max(score) as best, count(*) as runs from public.infinity_scores where user_id = auth.uid())
  select mine.best,
         1 + (select count(*) from (select max(score) b from public.infinity_scores group by user_id) t where t.b > mine.best),
         mine.runs
  from mine where mine.runs > 0 and auth.uid() is not null;
$$;

-- ---------- read: most recent submissions ----------
create or replace function public.get_recent_infinity(p_limit integer default 10)
returns table (player_name text, score integer, highest_combo integer, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select player_name, score, highest_combo, created_at
  from public.infinity_scores order by created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

-- ---------- permissions: least privilege ----------
revoke all on function public.submit_infinity_score(uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.get_infinity_leaderboard(integer) from public, anon, authenticated;
revoke all on function public.get_my_infinity_stats()           from public, anon, authenticated;
revoke all on function public.get_recent_infinity(integer)      from public, anon, authenticated;

grant execute on function public.submit_infinity_score(uuid, text, integer, integer, integer, integer) to authenticated;
grant execute on function public.get_infinity_leaderboard(integer) to anon, authenticated;
grant execute on function public.get_my_infinity_stats()           to authenticated;
grant execute on function public.get_recent_infinity(integer)      to anon, authenticated;
