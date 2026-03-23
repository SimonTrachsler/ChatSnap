-- =============================================================================
-- Ensure a profiles row exists for every auth user
-- =============================================================================
-- Trigger on auth.users: after insert, insert into public.profiles (id, email).
-- Uses ON CONFLICT DO UPDATE so existing rows (e.g. from app) are not failed.
-- =============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, created_at)
  values (new.id, new.email, now())
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Called by trigger on auth.users; ensures a profiles row exists for the new user.';

-- Trigger: run after a row is inserted into auth.users (sign up).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
