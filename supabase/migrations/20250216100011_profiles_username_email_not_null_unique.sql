-- =============================================================================
-- profiles: username and email UNIQUE NOT NULL, with indexes
-- Safe for existing rows: backfill nulls, then add constraints.
-- =============================================================================

-- Ensure email column exists
alter table public.profiles
  add column if not exists email text;

-- Backfill email from auth.users where missing
update public.profiles p
set email = coalesce(u.email, p.id::text || '@placeholder.local')
from auth.users u
where p.id = u.id
  and (p.email is null or trim(p.email) = '');

-- Any profile without auth.users (orphan) or still null: unique placeholder
update public.profiles
set email = id::text || '@placeholder.local'
where email is null or trim(email) = '';

-- Backfill username where null or empty (unique per id)
update public.profiles
set username = 'user_' || replace(id::text, '-', '')
where username is null or trim(username) = '';

-- Enforce NOT NULL (safe after backfill)
alter table public.profiles
  alter column username set not null,
  alter column email set not null;

-- Unique constraint on email (if not already present)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_email_key'
  ) then
    alter table public.profiles
      add constraint profiles_email_key unique (email);
  end if;
end $$;

-- username already has UNIQUE from initial create; ensure unique constraint name exists
-- (original table: "username text unique" creates profiles_username_key)
-- If somehow missing, add it:
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_username_key'
  ) then
    alter table public.profiles
      add constraint profiles_username_key unique (username);
  end if;
end $$;

-- Indexes: UNIQUE constraints above create unique indexes automatically
-- (profiles_username_key, profiles_email_key). No extra indexes needed.
