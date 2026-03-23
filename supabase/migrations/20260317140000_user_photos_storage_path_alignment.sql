-- =============================================================================
-- Align user_photos schema for clean save flow (storage_path) without breaking legacy rows.
-- Safe migration:
-- - adds storage_path when missing
-- - backfills from existing image_url values when possible
-- - keeps image_url for backward compatibility
-- =============================================================================

alter table public.user_photos
  add column if not exists storage_path text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_photos'
      and column_name = 'image_url'
  ) then
    update public.user_photos
    set storage_path = case
      when image_url is null or trim(image_url) = '' then storage_path
      when image_url like 'http://%' or image_url like 'https://%' then
        nullif(split_part(split_part(image_url, '/user-photos/', 2), '?', 1), '')
      else split_part(image_url, '?', 1)
    end
    where (storage_path is null or trim(storage_path) = '')
      and image_url is not null
      and trim(image_url) <> '';
  end if;
end $$;

comment on column public.user_photos.storage_path is
  'Preferred storage key in bucket user-photos (e.g. user_id/file.jpg).';

