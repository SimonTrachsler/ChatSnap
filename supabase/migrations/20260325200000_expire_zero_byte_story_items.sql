begin;

update public.stories s
set expires_at = now() - interval '1 second'
from storage.objects o
where o.bucket_id = 'stories-media'
  and public.normalize_story_media_path(s.media_path) = o.name
  and coalesce((o.metadata->>'size')::bigint, 0) = 0
  and s.expires_at > now();

commit;
