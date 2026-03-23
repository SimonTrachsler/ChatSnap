-- =============================================================================
-- user_photos RLS policies
-- - Users can insert only where user_id = auth.uid()
-- - Users can select only where user_id = auth.uid()
-- - Users cannot access other users' photos (no policy grants access to others)
-- - Users can delete their own photos
-- =============================================================================

alter table public.user_photos enable row level security;

-- Drop existing policies if re-running (idempotent)
drop policy if exists "user_photos_select_own" on public.user_photos;
drop policy if exists "user_photos_insert_own" on public.user_photos;
drop policy if exists "user_photos_update_own" on public.user_photos;
drop policy if exists "user_photos_delete_own" on public.user_photos;

-- Select: only own rows
create policy "user_photos_select_own"
  on public.user_photos for select
  to authenticated
  using (user_id = auth.uid());

-- Insert: only with user_id = self
create policy "user_photos_insert_own"
  on public.user_photos for insert
  to authenticated
  with check (user_id = auth.uid());

-- Delete: only own rows
create policy "user_photos_delete_own"
  on public.user_photos for delete
  to authenticated
  using (user_id = auth.uid());
