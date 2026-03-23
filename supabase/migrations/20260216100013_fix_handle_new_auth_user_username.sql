-- =============================================================================
-- Fix signup trigger: insert username (from metadata or fallback).
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
  profile_username := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    'user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
  );

  insert into public.profiles (id, email, username, created_at)
  values (new.id, new.email, profile_username, now())
  on conflict (id) do update set
    email = excluded.email,
    username = case when public.profiles.username is null then excluded.username else public.profiles.username end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
