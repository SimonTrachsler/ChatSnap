-- =============================================================================
-- Backfill profiles for existing auth users and harden username login lookup.
-- Context:
-- - Username login resolves email via public.profiles_get_email_by_username().
-- - After a profile reset/truncate, auth users may still exist but profiles rows are missing.
-- - This migration restores missing profiles and lets lookup fall back to auth.users metadata.
-- =============================================================================

-- 1) Backfill missing public.profiles rows from auth.users (best-effort username preservation)
with missing as (
  select
    u.id,
    coalesce(nullif(trim(u.email), ''), u.id::text || '@placeholder.local') as email,
    lower(
      coalesce(
        nullif(trim(u.raw_user_meta_data->>'username'), ''),
        nullif(trim(split_part(coalesce(u.email, ''), '@', 1)), ''),
        'user_' || substr(replace(u.id::text, '-', ''), 1, 12)
      )
    ) as username,
    coalesce(u.created_at, now()) as created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
)
insert into public.profiles (id, email, username, created_at)
select m.id, m.email, m.username, m.created_at
from missing m
on conflict (username) do nothing;

-- If username collisions prevented inserts above, retry with an ID suffix.
with missing as (
  select
    u.id,
    coalesce(nullif(trim(u.email), ''), u.id::text || '@placeholder.local') as email,
    lower(
      coalesce(
        nullif(trim(u.raw_user_meta_data->>'username'), ''),
        nullif(trim(split_part(coalesce(u.email, ''), '@', 1)), ''),
        'user_' || substr(replace(u.id::text, '-', ''), 1, 12)
      )
    ) as username,
    coalesce(u.created_at, now()) as created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
)
insert into public.profiles (id, email, username, created_at)
select
  m.id,
  m.email,
  m.username || '_' || substr(replace(m.id::text, '-', ''), 1, 12),
  m.created_at
from missing m
on conflict (id) do nothing;

-- 2) Username lookup: profiles first, then auth.users metadata fallback.
-- If a fallback match is found, ensure a profiles row exists for downstream app flows.
create or replace function public.profiles_get_email_by_username(search_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
  v_id uuid;
  v_email text;
  v_username_base text;
  v_created_at timestamptz;
begin
  normalized := trim(lower(coalesce(search_username, '')));
  if normalized = '' then
    return null;
  end if;

  -- Primary path: existing profile row.
  select p.email
  into v_email
  from public.profiles p
  where p.username is not null
    and trim(lower(p.username)) = normalized
  limit 1;

  if v_email is not null then
    return v_email;
  end if;

  -- Fallback for users missing a profile row (e.g. after profile truncate/reset).
  select
    u.id,
    coalesce(nullif(trim(u.email), ''), u.id::text || '@placeholder.local'),
    lower(
      coalesce(
        nullif(trim(u.raw_user_meta_data->>'username'), ''),
        nullif(trim(split_part(coalesce(u.email, ''), '@', 1)), ''),
        'user_' || substr(replace(u.id::text, '-', ''), 1, 12)
      )
    ),
    coalesce(u.created_at, now())
  into v_id, v_email, v_username_base, v_created_at
  from auth.users u
  where trim(lower(coalesce(u.raw_user_meta_data->>'username', ''))) = normalized
  limit 1;

  if v_id is null then
    return null;
  end if;

  begin
    insert into public.profiles (id, email, username, created_at)
    values (v_id, v_email, v_username_base, v_created_at)
    on conflict (id) do update
      set
        email = excluded.email,
        username = case
          when public.profiles.username is null or trim(public.profiles.username) = '' then excluded.username
          else public.profiles.username
        end;
  exception when unique_violation then
    insert into public.profiles (id, email, username, created_at)
    values (
      v_id,
      v_email,
      v_username_base || '_' || substr(replace(v_id::text, '-', ''), 1, 12),
      v_created_at
    )
    on conflict (id) do update
      set email = excluded.email;
  end;

  return v_email;
end;
$$;

comment on function public.profiles_get_email_by_username(text) is
  'Returns email for username login (case-insensitive). Falls back to auth.users metadata and restores missing profiles rows.';

grant execute on function public.profiles_get_email_by_username(text) to anon;
grant execute on function public.profiles_get_email_by_username(text) to authenticated;

