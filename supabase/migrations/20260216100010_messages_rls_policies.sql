-- =============================================================================
-- public.messages: RLS policies
-- SELECT: sender or receiver; INSERT: sender only; UPDATE/DELETE: sender only
-- =============================================================================

alter table public.messages enable row level security;

drop policy if exists "messages_select_own" on public.messages;
drop policy if exists "messages_insert_sender" on public.messages;

-- 1) SELECT: sender_id = auth.uid() OR receiver_id = auth.uid()
create policy "messages_select_own"
  on public.messages for select
  to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

-- 2) INSERT: sender_id = auth.uid()
create policy "messages_insert_sender"
  on public.messages for insert
  to authenticated
  with check (sender_id = auth.uid());

-- 3) UPDATE: only sender_id = auth.uid()
create policy "messages_update_sender"
  on public.messages for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- 4) DELETE: only sender_id = auth.uid()
create policy "messages_delete_sender"
  on public.messages for delete
  to authenticated
  using (sender_id = auth.uid());
