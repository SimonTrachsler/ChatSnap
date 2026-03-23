-- =============================================================================
-- public.friend_requests: RLS policies (verify/enforce)
-- - SELECT: requester or receiver
-- - INSERT: requester only
-- - UPDATE: requester or receiver (trigger enforces accept/decline by receiver, cancel by requester)
-- - DELETE: requester only when status = 'pending'
-- =============================================================================

alter table public.friend_requests enable row level security;

drop policy if exists "friend_requests_select_requester" on public.friend_requests;
drop policy if exists "friend_requests_select_receiver" on public.friend_requests;
drop policy if exists "friend_requests_select_from" on public.friend_requests;
drop policy if exists "friend_requests_select_to" on public.friend_requests;
drop policy if exists "friend_requests_insert" on public.friend_requests;
drop policy if exists "friend_requests_update_to" on public.friend_requests;
drop policy if exists "friend_requests_update_receiver_or_requester" on public.friend_requests;
drop policy if exists "friend_requests_delete_requester_pending" on public.friend_requests;

-- 1) SELECT: requester_id = auth.uid() OR receiver_id = auth.uid()
create policy "friend_requests_select_own"
  on public.friend_requests for select
  to authenticated
  using (requester_id = auth.uid() or receiver_id = auth.uid());

-- 2) INSERT: requester_id = auth.uid()
create policy "friend_requests_insert"
  on public.friend_requests for insert
  to authenticated
  with check (requester_id = auth.uid());

-- 3) UPDATE: receiver_id = auth.uid() OR requester_id = auth.uid()
--    (Trigger friend_requests_receiver_update_only_status enforces: only status changes;
--     receiver may set accepted/declined, requester may set canceled)
create policy "friend_requests_update_own"
  on public.friend_requests for update
  to authenticated
  using (receiver_id = auth.uid() or requester_id = auth.uid())
  with check (receiver_id = auth.uid() or requester_id = auth.uid());

-- 4) DELETE (optional): requester_id = auth.uid() AND status = 'pending'
create policy "friend_requests_delete_requester_pending"
  on public.friend_requests for delete
  to authenticated
  using (requester_id = auth.uid() and status = 'pending');
