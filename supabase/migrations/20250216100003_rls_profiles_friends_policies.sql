-- =============================================================================
-- RLS: profiles (own + search by email), friend_requests, friends
-- =============================================================================
-- Profiles: users read own profile only; search by email via function (id + email only).
-- Friend requests: create as sender; read as sender/receiver; only receiver updates status to accepted/declined.
-- Friends: insert only when an accepted friend_request exists between the two users.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PROFILES
-- -----------------------------------------------------------------------------
-- Remove policy that allowed reading all profiles (was for snap recipient dropdown).
-- Use profiles_select_own for full profile; use profiles_search() for finding users by email.
drop policy if exists "profiles_select_authenticated" on public.profiles;

-- Search by email: returns only id and email (no username etc).
-- Usage: select * from profiles_search('alice@example.com'); or prefix: profiles_search('alice');
create or replace function public.profiles_search(search_email text)
returns table (id uuid, email text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.email
  from public.profiles p
  where search_email is null
     or p.email ilike (search_email || '%')
$$;

comment on function public.profiles_search(text) is
  'Authenticated users can search profiles by email; returns only id and email.';

grant execute on function public.profiles_search(text) to authenticated;

-- -----------------------------------------------------------------------------
-- FRIEND_REQUESTS
-- -----------------------------------------------------------------------------
-- Only the receiver may update, and only the status column to 'accepted' or 'declined'.
-- Other columns (from_user, to_user, id, created_at) must remain unchanged.
create or replace function public.friend_requests_receiver_update_only_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from old.to_user then
    raise exception 'Only the receiver can update a friend request.';
  end if;
  if old.from_user is distinct from new.from_user
     or old.to_user is distinct from new.to_user
     or old.id is distinct from new.id
     or old.created_at is distinct from new.created_at then
    raise exception 'Only status can be updated.';
  end if;
  if new.status is null or new.status not in ('accepted', 'declined') then
    raise exception 'Status must be accepted or declined.';
  end if;
  return new;
end;
$$;

drop trigger if exists friend_requests_receiver_update_only_status on public.friend_requests;
create trigger friend_requests_receiver_update_only_status
  before update on public.friend_requests
  for each row
  execute function public.friend_requests_receiver_update_only_status();

-- -----------------------------------------------------------------------------
-- FRIENDS
-- -----------------------------------------------------------------------------
-- Drop the previous insert policy that allowed any insert by a participant.
drop policy if exists "friends_insert" on public.friends;

-- Insert allowed only when there is an accepted friend_request between user_a and user_b.
-- Enforces user_a < user_b (table constraint) and that the current user is one of the two.
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
          (fr.from_user = user_a and fr.to_user = user_b)
          or (fr.from_user = user_b and fr.to_user = user_a)
        )
    )
  );

-- =============================================================================
-- NOTES
-- =============================================================================
-- Profiles:
--   - Read own: SELECT from profiles (policy profiles_select_own).
--   - Search by email: SELECT * FROM profiles_search('alice@'); returns only (id, email).
--   - If you still need to list profiles for e.g. snap recipient picker, use profiles_search
--     or add a separate policy/view that exposes only the columns you need.
--
-- Friend requests:
--   - Insert: from_user must equal auth.uid() (policy friend_requests_insert).
--   - Select: visible if from_user = auth.uid() or to_user = auth.uid().
--   - Update: only to_user (receiver); trigger restricts changes to status = accepted|declined.
--
-- Friends:
--   - Insert: allowed only when a row in friend_requests exists with status = 'accepted'
--     for the same (user_a, user_b) pair (with user_a < user_b). App flow: receiver sets
--     request to accepted, then app inserts into friends (user_a, user_b); RLS allows it.
--   - No automatic insert on accept: the app must insert into friends after updating the
--     request to accepted (or use a trigger on friend_requests to insert into friends).
