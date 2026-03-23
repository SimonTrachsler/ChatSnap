-- =============================================================================
-- friend_requests: full lifecycle with requester_id / receiver_id and status canceled
-- - Rename from_user -> requester_id, to_user -> receiver_id (no data loss)
-- - Add status 'canceled' to check constraint
-- - Keep unique(requester_id, receiver_id), FKs to profiles(id)
-- - Update RLS policies and trigger to use new column names
-- =============================================================================

-- 1) Rename columns (indexes and constraints follow the column rename)
alter table public.friend_requests
  rename column from_user to requester_id;

alter table public.friend_requests
  rename column to_user to receiver_id;

-- 2) Extend status check to include 'canceled'
do $$
declare
  c name;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.friend_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.friend_requests drop constraint %I', c);
  end loop;
end $$;

alter table public.friend_requests
  add constraint friend_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'canceled'));

comment on column public.friend_requests.status is 'pending | accepted | declined | canceled';

-- 3) Rename constraints for clarity (optional; unique/check already apply to renamed columns)
--    Unique constraint name stays friend_requests_unique_pending (on requester_id, receiver_id)
--    Check constraint friend_requests_from_to_diff now checks requester_id <> receiver_id
--    No change needed; FKs still reference profiles(id) via the renamed columns.

-- 4) Drop and recreate RLS policies with new column names
drop policy if exists "friend_requests_select_from" on public.friend_requests;
drop policy if exists "friend_requests_select_to" on public.friend_requests;
drop policy if exists "friend_requests_insert" on public.friend_requests;
drop policy if exists "friend_requests_update_to" on public.friend_requests;

create policy "friend_requests_select_requester"
  on public.friend_requests for select
  to authenticated
  using (requester_id = auth.uid());

create policy "friend_requests_select_receiver"
  on public.friend_requests for select
  to authenticated
  using (receiver_id = auth.uid());

create policy "friend_requests_insert"
  on public.friend_requests for insert
  to authenticated
  with check (requester_id = auth.uid());

create policy "friend_requests_update_receiver_or_requester"
  on public.friend_requests for update
  to authenticated
  using (receiver_id = auth.uid() or requester_id = auth.uid())
  with check (receiver_id = auth.uid() or requester_id = auth.uid());

-- 5) Trigger: receiver may set accepted/declined; requester may set canceled; only status changes
create or replace function public.friend_requests_receiver_update_only_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.receiver_id then
    if new.status is null or new.status not in ('accepted', 'declined') then
      raise exception 'Receiver may only set status to accepted or declined.';
    end if;
  elsif auth.uid() = old.requester_id then
    if new.status is null or new.status <> 'canceled' then
      raise exception 'Requester may only set status to canceled.';
    end if;
  else
    raise exception 'Only the receiver or requester can update a friend request.';
  end if;
  if old.requester_id is distinct from new.requester_id
     or old.receiver_id is distinct from new.receiver_id
     or old.id is distinct from new.id
     or old.created_at is distinct from new.created_at then
    raise exception 'Only status can be updated.';
  end if;
  return new;
end;
$$;

drop trigger if exists friend_requests_receiver_update_only_status on public.friend_requests;
create trigger friend_requests_receiver_update_only_status
  before update on public.friend_requests
  for each row
  execute function public.friend_requests_receiver_update_only_status();

-- 6) friends_insert_if_accepted: reference requester_id/receiver_id
drop policy if exists "friends_insert_if_accepted" on public.friends;

create policy "friends_insert_if_accepted"
  on public.friends for insert
  to authenticated
  with check (
    user_a < user_b
    and (user_a = auth.uid() or user_b = auth.uid())
    and exists (
      select 1 from public.friend_requests fr
      where fr.status = 'accepted'
        and (
          (fr.requester_id = user_a and fr.receiver_id = user_b)
          or (fr.requester_id = user_b and fr.receiver_id = user_a)
        )
    )
  );

-- 7) Optional: rename indexes for clarity (column rename already updated index columns)
drop index if exists public.friend_requests_from_user_idx;
drop index if exists public.friend_requests_to_user_idx;
create index friend_requests_requester_id_idx on public.friend_requests (requester_id);
create index friend_requests_receiver_id_idx on public.friend_requests (receiver_id);
