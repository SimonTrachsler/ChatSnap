-- Return email for a given username (case-insensitive) for login flow.
-- Callable by anon so users can log in with username + password.
create or replace function public.profiles_get_email_by_username(search_username text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select p.email
  from public.profiles p
  where p.username is not null
    and trim(lower(p.username)) = trim(lower(search_username))
  limit 1;
$$;

comment on function public.profiles_get_email_by_username(text) is
  'Returns email for the given username (case-insensitive). Used for username-based login.';

grant execute on function public.profiles_get_email_by_username(text) to anon;
grant execute on function public.profiles_get_email_by_username(text) to authenticated;
