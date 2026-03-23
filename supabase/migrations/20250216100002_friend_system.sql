-- =============================================================================
-- Friend system: profiles email, friend_requests, friends
-- =============================================================================
-- profiles: already exists (id, username, created_at). Add email for lookup.
-- friend_requests: from_user -> to_user with status pending | accepted | declined
-- friends: symmetric pairs (user_a, user_b) with user_a < user_b to avoid duplicates
-- =============================================================================

-- Add email to profiles (optional; can be synced from auth.users)
alter table public.profiles
  add column if not exists email text;

-- =============================================================================
-- friend_requests
-- =============================================================================

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  constraint friend_requests_from_to_diff check (from_user <> to_user),
  constraint friend_requests_unique_pending unique (from_user, to_user)
);

comment on column public.friend_requests.status is 'pending | accepted | declined';

create index friend_requests_from_user_idx on public.friend_requests (from_user);
create index friend_requests_to_user_idx on public.friend_requests (to_user);
create index friend_requests_status_idx on public.friend_requests (status);
create index friend_requests_created_at_idx on public.friend_requests (created_at desc);

alter table public.friend_requests enable row level security;

-- Sender sees own outgoing requests
create policy "friend_requests_select_from"
  on public.friend_requests for select
  to authenticated
  using (from_user = auth.uid());

-- Recipient sees requests sent to them
create policy "friend_requests_select_to"
  on public.friend_requests for select
  to authenticated
  using (to_user = auth.uid());

-- Authenticated users can insert as from_user (send request)
create policy "friend_requests_insert"
  on public.friend_requests for insert
  to authenticated
  with check (from_user = auth.uid());

-- Only to_user can update (accept/decline)
create policy "friend_requests_update_to"
  on public.friend_requests for update
  to authenticated
  using (to_user = auth.uid())
  with check (to_user = auth.uid());

-- =============================================================================
-- friends (symmetric; user_a < user_b to avoid duplicate pairs)
-- =============================================================================

create table public.friends (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friends_a_b_diff check (user_a <> user_b),
  constraint friends_ordered check (user_a < user_b),
  constraint friends_unique_pair unique (user_a, user_b)
);

create index friends_user_a_idx on public.friends (user_a);
create index friends_user_b_idx on public.friends (user_b);
create index friends_created_at_idx on public.friends (created_at desc);

alter table public.friends enable row level security;

-- Users see rows where they are user_a or user_b
create policy "friends_select_own"
  on public.friends for select
  to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

-- Allow insert (e.g. from app when accepting a request); both users are “in” the row
create policy "friends_insert"
  on public.friends for insert
  to authenticated
  with check (user_a = auth.uid() or user_b = auth.uid());

-- Optional: allow delete to unfriend
create policy "friends_delete_own"
  on public.friends for delete
  to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());
