-- =============================================================================
-- profiles RLS: own full profile, lookup-by-username (id, email, username only)
-- Inserts/updates limited to owner. No direct read of other users' full rows.
-- =============================================================================

-- Drop any legacy policy that might allow broader read (idempotent)
drop policy if exists "profiles_select_authenticated" on public.profiles;

-- 1) Select: users can read their own full profile only
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- 2) Insert: only owner (id = auth.uid())
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- 3) Update: only owner
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 4) Lookup by username: returns only id, email, username (no created_at or other columns)
-- Callable by authenticated; use for search/display. Login uses profiles_get_email_by_username (anon).
create or replace function public.profiles_lookup_by_username(search_username text)
returns table (id uuid, email text, username text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.email, p.username
  from public.profiles p
  where p.username is not null
    and trim(lower(p.username)) = trim(lower(search_username))
  limit 1;
$$;

comment on function public.profiles_lookup_by_username(text) is
  'Authenticated users can look up a profile by username; returns only id, email, username.';

grant execute on function public.profiles_lookup_by_username(text) to authenticated;
