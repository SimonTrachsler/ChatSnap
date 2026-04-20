begin;

create or replace function public.normalize_story_media_path(p_path text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  if p_path is null then
    return null;
  end if;

  v := btrim(p_path);
  if v = '' then
    return v;
  end if;

  v := split_part(v, '?', 1);
  v := regexp_replace(v, '^.*?/storage/v1/object/(public|authenticated|sign)/stories-media/?', '', 'i');
  v := regexp_replace(v, '^.*?/storage/v1/object/stories-media/?', '', 'i');
  v := regexp_replace(v, '^/?public/stories-media/?', '', 'i');
  v := regexp_replace(v, '^/?stories-media/?', '', 'i');
  v := replace(replace(v, '%252F', '/'), '%252f', '/');
  v := replace(replace(v, '%2F', '/'), '%2f', '/');
  v := regexp_replace(v, '^/+', '');
  return v;
end;
$$;

update public.stories
set media_path = public.normalize_story_media_path(media_path)
where media_path is not null
  and media_path <> public.normalize_story_media_path(media_path);

create or replace function public.stories_normalize_media_path_before_write()
returns trigger
language plpgsql
as $$
begin
  new.media_path := public.normalize_story_media_path(new.media_path);
  return new;
end;
$$;

drop trigger if exists stories_normalize_media_path_before_write on public.stories;
create trigger stories_normalize_media_path_before_write
  before insert or update of media_path on public.stories
  for each row
  execute function public.stories_normalize_media_path_before_write();

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
        and public.normalize_story_media_path(s.media_path) = name
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
