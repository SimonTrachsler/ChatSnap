-- =============================================================================
-- Fix signup 500: handle_new_auth_user must set username (NOT NULL on profiles).
-- Trigger inserts into public.profiles on auth.users INSERT; username was missing.
-- =============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_username text;
begin
  -- Username: from signup metadata, or unique fallback per user (NOT NULL + UNIQUE)
  profile_username := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    'user_' || replace(new.id::text, '-', '')
  );

  insert into public.profiles (id, email, username, created_at)
  values (new.id, new.email, profile_username, now())
  on conflict (id) do update set
    email = excluded.email,
    username = coalesce(nullif(trim(public.profiles.username), ''), excluded.username);
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Called by trigger on auth.users; ensures a profiles row with id, email, username.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
