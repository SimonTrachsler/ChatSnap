begin;

create index if not exists stories_active_owner_created_idx
  on public.stories (user_id, expires_at desc, created_at desc);

create index if not exists stories_media_path_idx
  on public.stories (media_path);

drop policy if exists "stories_select_owner_or_friends" on public.stories;
create policy "stories_select_owner_or_friends"
  on public.stories
  for select
  to authenticated
  using (
    stories.expires_at > now()
    and (
      stories.user_id = auth.uid()
      or exists (
        select 1 from public.friends f
        where f.user_id = auth.uid()
          and f.friend_id = stories.user_id
      )
    )
  );

drop policy if exists "story_views_select_owner_or_viewer" on public.story_views;
create policy "story_views_select_owner_or_viewer"
  on public.story_views
  for select
  to authenticated
  using (
    story_views.viewer_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_views.story_id
        and s.user_id = auth.uid()
        and s.expires_at > now()
    )
  );

drop policy if exists "story_views_insert_own" on public.story_views;
create policy "story_views_insert_own"
  on public.story_views
  for insert
  to authenticated
  with check (
    story_views.viewer_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = story_views.story_id
        and s.expires_at > now()
        and s.user_id <> auth.uid()
        and exists (
          select 1 from public.friends f
          where f.user_id = auth.uid()
            and f.friend_id = s.user_id
        )
    )
  );

drop policy if exists "stories_media_select_owner_or_friends" on storage.objects;
create policy "stories_media_select_owner_or_friends"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'stories-media'
    and exists (
      select 1
      from public.stories s
      where s.media_path = name
        and s.expires_at > now()
        and (
          s.user_id = auth.uid()
          or exists (
            select 1 from public.friends f
            where f.user_id = auth.uid()
              and f.friend_id = s.user_id
          )
        )
    )
  );

commit;
