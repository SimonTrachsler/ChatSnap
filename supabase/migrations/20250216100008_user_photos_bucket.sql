-- =============================================================================
-- Storage Bucket "user-photos" (private)
-- Path convention: <user_id>/photo-<timestamp>.jpg
-- - Authenticated users can upload only to their own folder.
-- - Users can read/delete only their own files. No public read.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-photos',
  'user-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
);

-- Upload: only into own folder (first path segment = auth.uid())
create policy "user_photos_storage_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Read: only own files (no public read)
create policy "user_photos_storage_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: only own files
create policy "user_photos_storage_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
