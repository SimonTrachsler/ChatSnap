-- =============================================================================
-- RLS: profiles, friend_requests, friends (implement/verify)
-- 1) profiles: authenticated can select (public fields only via app or views)
-- 2) friend_requests: insert as requester; select as requester or receiver; receiver can update status
-- 3) friends: select own rows; insert only when accepted request exists (own row)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) PROFILES
-- Authenticated users can select any profile row (for usernames/public display).
-- "Public fields only" (id, username, avatar_url): RLS is row-level; restrict
-- columns in the app or use search_profiles() / profiles_lookup_by_username().
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public"
  on public.profiles for select
  to authenticated
  using (true);

comment on policy "profiles_select_public" on public.profiles is
  'Authenticated users may read any profile; app should select only public fields (id, username, avatar_url) for others.';

-- Own-row insert/update only
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- 2) FRIEND_REQUESTS
-- Works with from_user/to_user (original) OR requester_id/receiver_id (after rename).
-- -----------------------------------------------------------------------------
alter table public.friend_requests enable row level security;

drop policy if exists "friend_requests_select_own" on public.friend_requests;
drop policy if exists "friend_requests_select_requester" on public.friend_requests;
drop policy if exists "friend_requests_select_receiver" on public.friend_requests;
drop policy if exists "friend_requests_select_from" on public.friend_requests;
drop policy if exists "friend_requests_select_to" on public.friend_requests;
drop policy if exists "friend_requests_insert" on public.friend_requests;
drop policy if exists "friend_requests_insert_requester" on public.friend_requests;
drop policy if exists "friend_requests_update_to" on public.friend_requests;
drop policy if exists "friend_requests_update_own" on public.friend_requests;
drop policy if exists "friend_requests_update_receiver_or_requester" on public.friend_requests;
drop policy if exists "friend_requests_delete_requester_pending" on public.friend_requests;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'requester_id') then
    execute 'create policy "friend_requests_select_own" on public.friend_requests for select to authenticated using (requester_id = auth.uid() or receiver_id = auth.uid())';
    execute 'create policy "friend_requests_insert_requester" on public.friend_requests for insert to authenticated with check (requester_id = auth.uid())';
    execute 'create policy "friend_requests_update_own" on public.friend_requests for update to authenticated using (requester_id = auth.uid() or receiver_id = auth.uid()) with check (requester_id = auth.uid() or receiver_id = auth.uid())';
    execute 'create policy "friend_requests_delete_requester_pending" on public.friend_requests for delete to authenticated using (requester_id = auth.uid() and status = ''pending'')';
  elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'from_user') then
    execute 'create policy "friend_requests_select_own" on public.friend_requests for select to authenticated using (from_user = auth.uid() or to_user = auth.uid())';
    execute 'create policy "friend_requests_insert_requester" on public.friend_requests for insert to authenticated with check (from_user = auth.uid())';
    execute 'create policy "friend_requests_update_own" on public.friend_requests for update to authenticated using (from_user = auth.uid() or to_user = auth.uid()) with check (from_user = auth.uid() or to_user = auth.uid())';
    execute 'create policy "friend_requests_delete_requester_pending" on public.friend_requests for delete to authenticated using (from_user = auth.uid() and status = ''pending'')';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3) FRIENDS
-- Works with user_id/friend_id (after 20260216100004) OR user_a/user_b (original).
-- -----------------------------------------------------------------------------
alter table public.friends enable row level security;

drop policy if exists "friends_select_own" on public.friends;
drop policy if exists "friends_insert" on public.friends;
drop policy if exists "friends_insert_if_accepted" on public.friends;
drop policy if exists "friends_update_own" on public.friends;
drop policy if exists "friends_delete_own" on public.friends;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friends' and column_name = 'user_id') then
    -- Schema: user_id, friend_id
    execute 'create policy "friends_select_own" on public.friends for select to authenticated using (user_id = auth.uid())';
    execute 'create policy "friends_update_own" on public.friends for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())';
    execute 'create policy "friends_delete_own" on public.friends for delete to authenticated using (user_id = auth.uid())';
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'requester_id') then
      execute 'create policy "friends_insert_if_accepted" on public.friends for insert to authenticated with check (
        user_id <> friend_id and (user_id = auth.uid() or friend_id = auth.uid())
        and exists (select 1 from public.friend_requests fr where fr.status = ''accepted''
          and ((fr.requester_id = user_id and fr.receiver_id = friend_id) or (fr.requester_id = friend_id and fr.receiver_id = user_id)))
      )';
    elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'from_user') then
      execute 'create policy "friends_insert_if_accepted" on public.friends for insert to authenticated with check (
        user_id <> friend_id and (user_id = auth.uid() or friend_id = auth.uid())
        and exists (select 1 from public.friend_requests fr where fr.status = ''accepted''
          and ((fr.from_user = user_id and fr.to_user = friend_id) or (fr.from_user = friend_id and fr.to_user = user_id)))
      )';
    end if;
  elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friends' and column_name = 'user_a') then
    -- Schema: user_a, user_b (original)
    execute 'create policy "friends_select_own" on public.friends for select to authenticated using (user_a = auth.uid() or user_b = auth.uid())';
    execute 'create policy "friends_update_own" on public.friends for update to authenticated using (user_a = auth.uid() or user_b = auth.uid()) with check (user_a = auth.uid() or user_b = auth.uid())';
    execute 'create policy "friends_delete_own" on public.friends for delete to authenticated using (user_a = auth.uid() or user_b = auth.uid())';
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'requester_id') then
      execute 'create policy "friends_insert_if_accepted" on public.friends for insert to authenticated with check (
        user_a <> user_b and (user_a = auth.uid() or user_b = auth.uid())
        and exists (select 1 from public.friend_requests fr where fr.status = ''accepted''
          and ((fr.requester_id = user_a and fr.receiver_id = user_b) or (fr.requester_id = user_b and fr.receiver_id = user_a)))
      )';
    elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'from_user') then
      execute 'create policy "friends_insert_if_accepted" on public.friends for insert to authenticated with check (
        user_a <> user_b and (user_a = auth.uid() or user_b = auth.uid())
        and exists (select 1 from public.friend_requests fr where fr.status = ''accepted''
          and ((fr.from_user = user_a and fr.to_user = user_b) or (fr.from_user = user_b and fr.to_user = user_a)))
      )';
    end if;
  end if;
end $$;
