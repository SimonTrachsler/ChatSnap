-- =============================================================================
-- 1) Add avatar_url to profiles (optional, for search result display).
-- 2) search_profiles: case-insensitive CONTAINS on username, limit 20,
--    exclude current user, return id, username, avatar_url.
-- =============================================================================

-- Optional column for profile avatar URL (storage URL or external URL).
alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is 'Optional avatar image URL (storage or external).';

-- Replace search: prefix match -> contains match; return avatar_url.
create or replace function public.search_profiles(query text)
returns table (id uuid, username text, avatar_url text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.username, p.avatar_url
  from public.profiles p
  where (query is null or trim(query) = '' or p.username ilike ('%' || trim(query) || '%'))
    and p.id is distinct from auth.uid()
  order by p.username nulls last
  limit 20;
$$;

comment on function public.search_profiles(text) is
  'Search profiles by username (case-insensitive contains); returns id, username, avatar_url; excludes current user; max 20.';

grant execute on function public.search_profiles(text) to authenticated;
