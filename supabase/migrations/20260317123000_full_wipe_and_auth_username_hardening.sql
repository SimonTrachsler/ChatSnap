-- =============================================================================
-- FULL WIPE + HARDENING
-- WARNING: This migration irreversibly removes all auth accounts.
-- Stored media must be removed via Storage API (Edge Function admin-reset).
-- =============================================================================

-- 1) Remove all auth users (CASCADE removes related profile-linked rows).
delete from auth.users;

-- 2) Ensure app tables are fully empty as a deterministic post-wipe state.
truncate table
  public.friend_aliases,
  public.chat_messages,
  public.chat_threads,
  public.snaps,
  public.user_photos,
  public.friends,
  public.friend_requests,
  public.profiles
restart identity cascade;

-- 3) Username hardening on profiles.
alter table public.profiles
  drop constraint if exists profiles_username_not_blank_chk;

alter table public.profiles
  add constraint profiles_username_not_blank_chk
  check (length(trim(username)) > 0);

create unique index if not exists profiles_username_lower_uq
  on public.profiles (lower(username));

create or replace function public.normalize_profile_username()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.username is not null then
    new.username := lower(trim(new.username));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_normalize_username_trg on public.profiles;
create trigger profiles_normalize_username_trg
  before insert or update on public.profiles
  for each row
  execute function public.normalize_profile_username();

-- 4) Harden auth -> profile trigger against username collisions.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  profile_username text;
begin
  base_username := lower(
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'username'), ''),
      nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      'user_' || substr(replace(new.id::text, '-', ''), 1, 12)
    )
  );
  profile_username := base_username;

  begin
    insert into public.profiles (id, email, username, created_at)
    values (
      new.id,
      coalesce(nullif(trim(new.email), ''), new.id::text || '@placeholder.local'),
      profile_username,
      coalesce(new.created_at, now())
    )
    on conflict (id) do update
      set
        email = excluded.email,
        username = case
          when public.profiles.username is null or trim(public.profiles.username) = '' then excluded.username
          else lower(trim(public.profiles.username))
        end;
  exception when unique_violation then
    profile_username := base_username || '_' || substr(replace(new.id::text, '-', ''), 1, 8);
    insert into public.profiles (id, email, username, created_at)
    values (
      new.id,
      coalesce(nullif(trim(new.email), ''), new.id::text || '@placeholder.local'),
      profile_username,
      coalesce(new.created_at, now())
    )
    on conflict (id) do update
      set email = excluded.email;
  end;

  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Creates/updates profile for new auth users with normalized, collision-safe username.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
