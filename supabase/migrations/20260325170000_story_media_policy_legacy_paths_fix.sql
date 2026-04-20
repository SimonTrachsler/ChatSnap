begin;

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
      where s.expires_at > now()
        and (
          s.media_path = name
          or split_part(s.media_path, '?', 1) = ('stories-media/' || name)
          or split_part(s.media_path, '?', 1) = ('public/stories-media/' || name)
          or split_part(s.media_path, '?', 1) like ('%/storage/v1/object/public/stories-media/' || name)
          or split_part(s.media_path, '?', 1) like ('%/storage/v1/object/authenticated/stories-media/' || name)
          or split_part(s.media_path, '?', 1) like ('%/storage/v1/object/sign/stories-media/' || name)
          or split_part(s.media_path, '?', 1) like ('%/storage/v1/object/public/stories-media/' || replace(name, '/', '%2F'))
          or split_part(s.media_path, '?', 1) like ('%/storage/v1/object/authenticated/stories-media/' || replace(name, '/', '%2F'))
          or split_part(s.media_path, '?', 1) like ('%/storage/v1/object/sign/stories-media/' || replace(name, '/', '%2F'))
        )
        and (
          s.user_id = auth.uid()
          or exists (
            select 1
            from public.friends f
            where f.user_id = auth.uid()
              and f.friend_id = s.user_id
          )
        )
    )
  );

commit;
