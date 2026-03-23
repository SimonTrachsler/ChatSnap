-- =============================================================================
-- ChatSnap friend system: Schema A + status declined. Pure SQL only (no DO blocks).
-- Assumes: friends has user_a, user_b; friend_requests has requester_id, receiver_id.
-- If friends already has user_id, friend_id, skip this migration or run only
-- the friend_requests and RPC sections (steps 1, 7, 8, 9, 10) manually.
-- =============================================================================

-- 1) Normalize friend_requests.status to pending | accepted | declined
update public.friend_requests
set status = 'declined'
where status not in ('pending', 'accepted', 'declined');

-- Drop existing status check (name from 20260216100015 or similar)
alter table public.friend_requests drop constraint if exists friend_requests_status_check;

alter table public.friend_requests
  add constraint friend_requests_status_check
  check (status in ('pending', 'accepted', 'declined'));

comment on column public.friend_requests.status is 'pending | accepted | declined';

-- 2) Create new friends table (Schema A: user_id, friend_id)
create table public.friends_new (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friends_new_user_friend_diff check (user_id <> friend_id),
  constraint friends_new_unique_pair unique (user_id, friend_id)
);

-- 3) Indexes on friends_new
create index friends_new_user_id_idx on public.friends_new (user_id);
create index friends_new_friend_id_idx on public.friends_new (friend_id);
create index friends_new_created_at_idx on public.friends_new (created_at desc);

alter table public.friends_new enable row level security;

-- 4) Backfill from old friends(user_a, user_b): two rows per pair
insert into public.friends_new (user_id, friend_id, created_at)
select user_a, user_b, created_at from public.friends
on conflict (user_id, friend_id) do nothing;

insert into public.friends_new (user_id, friend_id, created_at)
select user_b, user_a, created_at from public.friends
on conflict (user_id, friend_id) do nothing;

-- 5) Drop RLS and trigger on old friends, then rename
drop policy if exists "friends_select_own" on public.friends;
drop policy if exists "friends_insert_if_accepted" on public.friends;
drop policy if exists "friends_insert" on public.friends;
drop policy if exists "friends_update_own" on public.friends;
drop policy if exists "friends_delete_own" on public.friends;

drop trigger if exists snaps_recipient_must_be_friend on public.snaps;

alter table public.friends rename to friends_old;
alter table public.friends_new rename to friends;

-- 6) RLS on public.friends (select/delete only; insert via RPC)
create policy "friends_select_own"
  on public.friends for select to authenticated
  using (user_id = auth.uid());

create policy "friends_delete_own"
  on public.friends for delete to authenticated
  using (user_id = auth.uid());

-- Snaps trigger: user_id / friend_id
create or replace function public.snaps_recipient_must_be_friend()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.friends f
    where f.user_id = new.sender_id and f.friend_id = new.recipient_id
  ) then
    raise exception 'Snaps können nur an angenommene Freunde gesendet werden.';
  end if;
  return new;
end;
$$;

create trigger snaps_recipient_must_be_friend
  before insert on public.snaps for each row
  execute function public.snaps_recipient_must_be_friend();

-- 7) Partial unique index: one pending request per unordered pair
drop index if exists friend_requests_one_pending_per_pair;

create unique index friend_requests_unique_pending_pair
  on public.friend_requests (least(requester_id, receiver_id), greatest(requester_id, receiver_id))
  where (status = 'pending');

-- 8) Trigger: receiver may set accepted|declined; requester may set declined only
drop trigger if exists friend_requests_receiver_update_only_status on public.friend_requests;

create or replace function public.friend_requests_receiver_update_only_status()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() = old.receiver_id then
    if new.status is null or new.status not in ('accepted', 'declined') then
      raise exception 'Receiver may only set status to accepted or declined.';
    end if;
  elsif auth.uid() = old.requester_id then
    if new.status is null or new.status <> 'declined' then
      raise exception 'Requester may only set status to declined (withdraw).';
    end if;
  else
    raise exception 'Only the receiver or requester can update a friend request.';
  end if;
  if old.requester_id is distinct from new.requester_id or old.receiver_id is distinct from new.receiver_id or old.id is distinct from new.id then
    raise exception 'Only status can be updated.';
  end if;
  return new;
end;
$fn$;

create trigger friend_requests_receiver_update_only_status
  before update on public.friend_requests for each row
  execute function public.friend_requests_receiver_update_only_status();

-- 9) RLS friend_requests
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

-- 10) RPC: accept_friend_request (SECURITY DEFINER)
drop function if exists public.accept_friend_request(uuid);

create or replace function public.accept_friend_request(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_id uuid;
  v_receiver_id uuid;
  v_me uuid := auth.uid();
begin
  select fr.requester_id, fr.receiver_id into v_requester_id, v_receiver_id
  from public.friend_requests fr
  where fr.id = request_id and fr.status = 'pending';

  if v_requester_id is null or v_receiver_id is null then
    raise exception 'Friend request not found or already processed.';
  end if;
  if v_receiver_id <> v_me then
    raise exception 'Only the receiver can accept this request.';
  end if;

  update public.friend_requests
  set status = 'accepted'
  where id = request_id and receiver_id = v_me and status = 'pending';

  insert into public.friends (user_id, friend_id)
  values (v_me, v_requester_id), (v_requester_id, v_me)
  on conflict (user_id, friend_id) do nothing;

  return jsonb_build_object(
    'success', true,
    'requester_id', v_requester_id,
    'receiver_id', v_receiver_id,
    'status', 'accepted'
  );
end;
$$;

comment on function public.accept_friend_request(uuid) is
  'Accepts a pending friend request: sets status = accepted and inserts both friends rows. SECURITY DEFINER.';

grant execute on function public.accept_friend_request(uuid) to authenticated;
