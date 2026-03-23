-- =============================================================================
-- user_photos
-- =============================================================================

create table public.user_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  image_url text,
  created_at timestamptz not null default now()
);

create index user_photos_user_id_idx on public.user_photos (user_id);

alter table public.user_photos enable row level security;

-- User can select own photos
create policy "user_photos_select_own"
  on public.user_photos for select
  to authenticated
  using (user_id = auth.uid());

-- User can insert own photos (user_id must be self)
create policy "user_photos_insert_own"
  on public.user_photos for insert
  to authenticated
  with check (user_id = auth.uid());

-- User can update own photos
create policy "user_photos_update_own"
  on public.user_photos for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- User can delete own photos
create policy "user_photos_delete_own"
  on public.user_photos for delete
  to authenticated
  using (user_id = auth.uid());
