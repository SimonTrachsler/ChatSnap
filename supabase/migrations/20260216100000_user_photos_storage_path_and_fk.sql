-- =============================================================================
-- user_photos: ensure storage_path column and auth.users reference
-- - Add storage_path (text not null), migrate from image_url, drop image_url
-- - Change user_id FK from profiles(id) to auth.users(id)
-- Does not break existing data.
-- =============================================================================

-- 1) Add storage_path and migrate existing data from image_url (idempotent)
alter table public.user_photos
  add column if not exists storage_path text;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_photos' and column_name = 'image_url'
  ) then
    update public.user_photos set storage_path = coalesce(image_url, '') where storage_path is null;
  end if;
end $$;

alter table public.user_photos
  alter column storage_path set not null;

alter table public.user_photos
  drop column if exists image_url;

-- 2) user_id: point FK to auth.users(id) instead of profiles(id)
-- Constraint name is typically table_column_fkey
alter table public.user_photos
  drop constraint if exists user_photos_user_id_fkey;

alter table public.user_photos
  add constraint user_photos_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

-- 3) Ensure id, created_at match spec (already set in 20250216100006; no-op if correct)
-- id: uuid default gen_random_uuid() primary key
-- created_at: timestamptz default now()
comment on column public.user_photos.storage_path is 'Storage path in user-photos bucket (e.g. user_id/timestamp.jpg)';
