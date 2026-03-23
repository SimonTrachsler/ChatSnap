-- =============================================================================
-- profiles
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- User sieht nur eigenes Profil
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- User darf eigenes Profil anlegen (z. B. bei Registrierung)
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- User darf eigenes Profil updaten
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- snaps
-- =============================================================================

create table public.snaps (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  media_url text,
  opened boolean not null default false,
  created_at timestamptz not null default now(),
  constraint snaps_sender_recipient_diff check (sender_id <> recipient_id)
);

create index snaps_sender_id_idx on public.snaps (sender_id);
create index snaps_recipient_id_idx on public.snaps (recipient_id);
create index snaps_created_at_idx on public.snaps (created_at desc);

alter table public.snaps enable row level security;

-- User sieht nur Snaps, wo er Sender oder Empfänger ist
create policy "snaps_select_sender_or_recipient"
  on public.snaps for select
  to authenticated
  using (
    sender_id = auth.uid() or recipient_id = auth.uid()
  );

-- Nur Sender darf einen neuen Snap anlegen
create policy "snaps_insert_as_sender"
  on public.snaps for insert
  to authenticated
  with check (sender_id = auth.uid());

-- Recipient darf Zeile updaten (nur opened, siehe Trigger)
create policy "snaps_update_recipient"
  on public.snaps for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Recipient darf nur opened von false auf true setzen; andere Spalten unverändert
create or replace function public.snaps_recipient_update_only_opened()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.recipient_id then
    if new.sender_id is distinct from old.sender_id
       or new.recipient_id is distinct from old.recipient_id
       or new.media_url is distinct from old.media_url
       or new.id is distinct from old.id
       or new.created_at is distinct from old.created_at then
      raise exception 'Recipient darf nur opened setzen.';
    end if;
    if new.opened is distinct from old.opened and (new.opened is not true or old.opened is true) then
      raise exception 'Recipient darf opened nur von false auf true setzen.';
    end if;
  end if;
  return new;
end;
$$;

create trigger snaps_recipient_update_only_opened
  before update on public.snaps
  for each row
  execute function public.snaps_recipient_update_only_opened();

-- =============================================================================
-- Storage Bucket "snaps"
-- Pfadkonvention: <snap_id>/<filename> (z. B. abc-123/photo.jpg)
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'snaps',
  'snaps',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4']
);

-- Lese-Zugriff nur für Sender oder Recipient des Snaps (erstes Pfadsegment = snap_id)
create policy "snaps_storage_select_sender_or_recipient"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'snaps'
    and exists (
      select 1 from public.snaps s
      where s.id::text = (storage.foldername(name))[1]
      and (s.sender_id = auth.uid() or s.recipient_id = auth.uid())
    )
  );

-- Upload nur für Sender des Snaps
create policy "snaps_storage_insert_sender"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'snaps'
    and exists (
      select 1 from public.snaps s
      where s.id::text = (storage.foldername(name))[1]
      and s.sender_id = auth.uid()
    )
  );

-- Optional: Sender darf eigene Dateien im Snap löschen
create policy "snaps_storage_delete_sender"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'snaps'
    and exists (
      select 1 from public.snaps s
      where s.id::text = (storage.foldername(name))[1]
      and s.sender_id = auth.uid()
    )
  );
