-- =============================================================================
-- public.user_photos: enable RLS and ensure policies
-- SELECT / INSERT: user_id = auth.uid()
-- DELETE / UPDATE (optional): user_id = auth.uid()
-- =============================================================================

alter table public.user_photos enable row level security;

drop policy if exists "user_photos_select_own" on public.user_photos;
drop policy if exists "user_photos_insert_own" on public.user_photos;
drop policy if exists "user_photos_update_own" on public.user_photos;
drop policy if exists "user_photos_delete_own" on public.user_photos;

-- SELECT: only own rows
create policy "user_photos_select_own"
  on public.user_photos for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT: only with user_id = self
create policy "user_photos_insert_own"
  on public.user_photos for insert
  to authenticated
  with check (user_id = auth.uid());

-- DELETE: only own rows
create policy "user_photos_delete_own"
  on public.user_photos for delete
  to authenticated
  using (user_id = auth.uid());

-- UPDATE: only own rows
create policy "user_photos_update_own"
  on public.user_photos for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
