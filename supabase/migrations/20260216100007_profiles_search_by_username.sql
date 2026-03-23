-- =============================================================================
-- Search profiles by username (prefix match), exclude current user
-- =============================================================================

create or replace function public.search_profiles(query text)
returns table (id uuid, username text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.username
  from public.profiles p
  where (query is null or trim(query) = '' or p.username ilike (trim(query) || '%'))
    and p.id is distinct from auth.uid()
  order by p.username
  limit 20;
$$;

comment on function public.search_profiles(text) is
  'Search profiles by username prefix; returns id and username; excludes current user.';

grant execute on function public.search_profiles(text) to authenticated;
