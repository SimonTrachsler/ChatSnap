-- =============================================================================
-- Ensure friend_requests has requester_id and receiver_id (app expects these).
-- If the table still has from_user/to_user, rename them and fix RLS policies.
-- No data loss.
-- =============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'from_user')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'requester_id') then
    alter table public.friend_requests rename column from_user to requester_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'to_user')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'receiver_id') then
    alter table public.friend_requests rename column to_user to receiver_id;
  end if;
end $$;

-- Recreate RLS policies so they use requester_id/receiver_id (after rename)
drop policy if exists "friend_requests_select_own" on public.friend_requests;
drop policy if exists "friend_requests_insert_requester" on public.friend_requests;
drop policy if exists "friend_requests_update_own" on public.friend_requests;
drop policy if exists "friend_requests_delete_requester_pending" on public.friend_requests;

create policy "friend_requests_select_own"
  on public.friend_requests for select to authenticated
  using (requester_id = auth.uid() or receiver_id = auth.uid());

create policy "friend_requests_insert_requester"
  on public.friend_requests for insert to authenticated
  with check (requester_id = auth.uid());

create policy "friend_requests_update_own"
  on public.friend_requests for update to authenticated
  using (requester_id = auth.uid() or receiver_id = auth.uid())
  with check (requester_id = auth.uid() or receiver_id = auth.uid());

create policy "friend_requests_delete_requester_pending"
  on public.friend_requests for delete to authenticated
  using (requester_id = auth.uid() and status = 'pending');
