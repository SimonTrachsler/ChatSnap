-- =============================================================================
-- Finalize user_photos to storage-path-only references.
-- - normalize existing storage_path values
-- - backfill from legacy image_url when the column still exists
-- - remove unusable rows without any bucket path
-- - enforce storage_path as the single persisted reference
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
      when storage_path is not null and trim(storage_path) <> '' then
        case
          when storage_path like 'http://%' or storage_path like 'https://%' then
            nullif(split_part(split_part(storage_path, '/user-photos/', 2), '?', 1), '')
          else nullif(split_part(storage_path, '?', 1), '')
        end
      when image_url is null or trim(image_url) = '' then null
      when image_url like 'http://%' or image_url like 'https://%' then
        nullif(split_part(split_part(image_url, '/user-photos/', 2), '?', 1), '')
      else nullif(split_part(image_url, '?', 1), '')
    end;
  else
    update public.user_photos
    set storage_path = case
      when storage_path is null or trim(storage_path) = '' then null
      when storage_path like 'http://%' or storage_path like 'https://%' then
        nullif(split_part(split_part(storage_path, '/user-photos/', 2), '?', 1), '')
      else nullif(split_part(storage_path, '?', 1), '')
    end;
  end if;
end $$;

delete from public.user_photos
where storage_path is null or trim(storage_path) = '';

alter table public.user_photos
  alter column storage_path set not null;

alter table public.user_photos
  drop column if exists image_url;

comment on column public.user_photos.storage_path is
  'Storage key in bucket user-photos (for example user_id/file.jpg).';
