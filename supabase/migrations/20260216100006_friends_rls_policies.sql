-- =============================================================================
-- public.friends: RLS policies (verify/enforce)
-- - SELECT: user_id = auth.uid() (do not allow reading others' friendships)
-- - INSERT: user_id = auth.uid() (and accepted request; see with check)
-- - UPDATE / DELETE: user_id = auth.uid()
-- =============================================================================

alter table public.friends enable row level security;

drop policy if exists "friends_select_own" on public.friends;
drop policy if exists "friends_insert" on public.friends;
drop policy if exists "friends_insert_if_accepted" on public.friends;
drop policy if exists "friends_delete_own" on public.friends;
drop policy if exists "friends_update_own" on public.friends;

-- 1) SELECT: user_id = auth.uid()
create policy "friends_select_own"
  on public.friends for select
  to authenticated
  using (user_id = auth.uid());

-- 2) INSERT: user_id = auth.uid() (or friend_id = auth.uid() for reverse row); only when accepted request exists
create policy "friends_insert_if_accepted"
  on public.friends for insert
  to authenticated
  with check (
    (user_id = auth.uid() or friend_id = auth.uid())
    and user_id <> friend_id
    and exists (
      select 1 from public.friend_requests fr
      where fr.status = 'accepted'
        and (
          (fr.requester_id = user_id and fr.receiver_id = friend_id)
          or (fr.requester_id = friend_id and fr.receiver_id = user_id)
        )
    )
  );

-- 3) UPDATE: user_id = auth.uid()
create policy "friends_update_own"
  on public.friends for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 4) DELETE: user_id = auth.uid()
create policy "friends_delete_own"
  on public.friends for delete
  to authenticated
  using (user_id = auth.uid());
