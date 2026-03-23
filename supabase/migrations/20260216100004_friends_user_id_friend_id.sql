-- =============================================================================
-- public.friends: (user_id, friend_id) with two rows per friendship (A->B, B->A)
-- - id, user_id, friend_id, created_at
-- - unique (user_id, friend_id)
-- - Migrate existing (user_a, user_b) data to two rows each; then swap table.
-- =============================================================================

-- 1) Create new table with desired schema
create table public.friends_new (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friends_new_user_friend_diff check (user_id <> friend_id),
  constraint friends_new_unique_pair unique (user_id, friend_id)
);

create index friends_new_user_id_idx on public.friends_new (user_id);
create index friends_new_friend_id_idx on public.friends_new (friend_id);
create index friends_new_created_at_idx on public.friends_new (created_at desc);

alter table public.friends_new enable row level security;

-- 2) Migrate data: each (user_a, user_b) becomes two rows (user_a, user_b) and (user_b, user_a)
insert into public.friends_new (user_id, friend_id, created_at)
select user_a, user_b, created_at from public.friends
union all
select user_b, user_a, created_at from public.friends;

-- 3) Drop RLS policies and trigger that depend on public.friends
drop policy if exists "friends_select_own" on public.friends;
drop policy if exists "friends_insert_if_accepted" on public.friends;
drop policy if exists "friends_delete_own" on public.friends;
drop policy if exists "friends_insert" on public.friends;

drop trigger if exists snaps_recipient_must_be_friend on public.snaps;

-- 4) Swap tables
alter table public.friends rename to friends_old;
alter table public.friends_new rename to friends;

-- 5) RLS on public.friends (new)
create policy "friends_select_own"
  on public.friends for select
  to authenticated
  using (user_id = auth.uid());

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

create policy "friends_delete_own"
  on public.friends for delete
  to authenticated
  using (user_id = auth.uid());

-- 6) Snaps trigger: recipient must be friend (one row where user_id = sender, friend_id = recipient)
create or replace function public.snaps_recipient_must_be_friend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  before insert on public.snaps
  for each row
  execute function public.snaps_recipient_must_be_friend();

-- 7) Drop old table
drop table public.friends_old;
