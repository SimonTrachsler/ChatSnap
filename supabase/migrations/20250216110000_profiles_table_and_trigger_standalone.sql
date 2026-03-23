-- =============================================================================
-- Standalone: Tabelle public.profiles anlegen + Trigger für Registrierung
-- Im Supabase Dashboard: SQL Editor → New query → dieses Skript einfügen → Run
-- =============================================================================

-- Tabelle (falls noch nicht vorhanden)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  email text,
  created_at timestamptz not null default now()
);

-- Eindeutigkeit für Login/Suche (nur anlegen, falls noch nicht da)
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_key') then
    alter table public.profiles add constraint profiles_username_key unique (username);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_email_key') then
    alter table public.profiles add constraint profiles_email_key unique (email);
  end if;
end $$;

-- RLS aktivieren
alter table public.profiles enable row level security;

-- Richtlinien (alte ggf. entfernen, dann neu anlegen)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Optional: alle authentifizierten User dürfen Profile lesen (z. B. für Freundesliste)
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated
  using (true);

-- Trigger: Bei neuem Auth-User automatisch Profilzeile anlegen
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- =============================================================================
-- Login mit Benutzername: E-Mail zu Username ermitteln (anon + authenticated)
-- =============================================================================
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

grant execute on function public.profiles_get_email_by_username(text) to anon;
grant execute on function public.profiles_get_email_by_username(text) to authenticated;
