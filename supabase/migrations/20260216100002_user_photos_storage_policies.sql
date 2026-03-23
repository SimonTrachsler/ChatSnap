-- =============================================================================
-- Storage bucket "user-photos": verify policies
-- - Upload: authenticated only into own folder (auth.uid() = first path segment)
-- - Read: authenticated only their own files (same rule)
-- =============================================================================

drop policy if exists "user_photos_storage_insert_own" on storage.objects;
drop policy if exists "user_photos_storage_select_own" on storage.objects;

-- Upload: only into own folder (first path segment = auth.uid())
create policy "user_photos_storage_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Read: only own files
create policy "user_photos_storage_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
