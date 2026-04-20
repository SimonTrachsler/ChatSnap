-- Social feature MVP bundle:
-- 1) async voice/video chat messages
-- 2) stories with view state
-- 3) best friends ranking
-- 4) reactions on chat messages
-- 5) edit/delete support with guardrails
-- 6) sensitive snaps + screenshot hint events
-- 7) group chats
-- 8) scheduled chat sending
-- 9) camera/memory helpers (favorites)
-- 10) memories support tables
-- 11) friendship streak stats RPC

begin;

-- -----------------------------------------------------------------------------
-- Chat message enrichments
-- -----------------------------------------------------------------------------
alter table public.chat_messages
  add column if not exists media_path text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists edited_at timestamptz null,
  add column if not exists deleted_at timestamptz null,
  add column if not exists scheduled_for timestamptz null;

-- Sender can update own message body/media metadata (guarded by trigger below).
drop policy if exists "chat_messages_update_sender_manage_own" on public.chat_messages;
create policy "chat_messages_update_sender_manage_own"
  on public.chat_messages
  for update
  to authenticated
  using (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.id = thread_id and (t.user_a = auth.uid() or t.user_b = auth.uid())
    )
  )
  with check (sender_id = auth.uid());

create or replace function public.chat_messages_before_update_guard()
returns trigger
language plpgsql
as $$
declare
  v_editor uuid := auth.uid();
begin
  if v_editor is null then
    return new;
  end if;

  if new.sender_id <> v_editor then
    return new;
  end if;

  -- Once deleted, message content must stay deleted.
  if old.deleted_at is not null then
    new.body := old.body;
    new.message_type := old.message_type;
    new.media_path := old.media_path;
    new.metadata := old.metadata;
    new.edited_at := old.edited_at;
    new.deleted_at := old.deleted_at;
    return new;
  end if;

  -- Soft-delete path.
  if new.deleted_at is not null and old.deleted_at is null then
    new.body := '[deleted]';
    new.message_type := 'text';
    new.media_path := null;
    new.metadata := '{}'::jsonb;
    new.edited_at := null;
    return new;
  end if;

  -- Edit window (15 minutes).
  if now() - old.created_at > interval '15 minutes' then
    if new.body is distinct from old.body
      or new.message_type is distinct from old.message_type
      or new.media_path is distinct from old.media_path
      or new.metadata is distinct from old.metadata then
      raise exception 'MESSAGE_EDIT_WINDOW_EXPIRED'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.body is distinct from old.body
    or new.message_type is distinct from old.message_type
    or new.media_path is distinct from old.media_path
    or new.metadata is distinct from old.metadata then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists chat_messages_before_update_guard on public.chat_messages;
create trigger chat_messages_before_update_guard
  before update on public.chat_messages
  for each row
  execute function public.chat_messages_before_update_guard();

-- -----------------------------------------------------------------------------
-- Chat message reactions
-- -----------------------------------------------------------------------------
create table if not exists public.chat_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  constraint chat_message_reactions_emoji_len_check check (char_length(emoji) between 1 and 12),
  constraint chat_message_reactions_unique unique (message_id, user_id, emoji)
);

create index if not exists chat_message_reactions_message_idx
  on public.chat_message_reactions (message_id, created_at desc);

alter table public.chat_message_reactions enable row level security;

drop policy if exists "chat_message_reactions_select_participant" on public.chat_message_reactions;
create policy "chat_message_reactions_select_participant"
  on public.chat_message_reactions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.chat_messages m
      join public.chat_threads t on t.id = m.thread_id
      where m.id = message_id
        and (t.user_a = auth.uid() or t.user_b = auth.uid())
    )
  );

drop policy if exists "chat_message_reactions_insert_own" on public.chat_message_reactions;
create policy "chat_message_reactions_insert_own"
  on public.chat_message_reactions
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.chat_messages m
      join public.chat_threads t on t.id = m.thread_id
      where m.id = message_id
        and (t.user_a = auth.uid() or t.user_b = auth.uid())
    )
  );

drop policy if exists "chat_message_reactions_delete_own" on public.chat_message_reactions;
create policy "chat_message_reactions_delete_own"
  on public.chat_message_reactions
  for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function public.toggle_chat_message_reaction(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_exists boolean := false;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if trim(coalesce(p_emoji, '')) = '' then
    raise exception 'EMPTY_REACTION' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.chat_message_reactions r
    where r.message_id = p_message_id
      and r.user_id = v_me
      and r.emoji = p_emoji
  ) then
    delete from public.chat_message_reactions
    where message_id = p_message_id and user_id = v_me and emoji = p_emoji;
    return false;
  end if;

  insert into public.chat_message_reactions(message_id, user_id, emoji)
  values (p_message_id, v_me, p_emoji);
  return true;
end;
$$;

grant execute on function public.toggle_chat_message_reaction(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Scheduled messages
-- -----------------------------------------------------------------------------
create table if not exists public.scheduled_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  message_type text not null default 'text',
  snap_id uuid null references public.snaps(id) on delete set null,
  media_path text null,
  metadata jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null,
  sent_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists scheduled_chat_messages_due_idx
  on public.scheduled_chat_messages (sender_id, scheduled_for)
  where sent_at is null;

alter table public.scheduled_chat_messages enable row level security;

drop policy if exists "scheduled_chat_messages_select_own" on public.scheduled_chat_messages;
create policy "scheduled_chat_messages_select_own"
  on public.scheduled_chat_messages
  for select
  to authenticated
  using (sender_id = auth.uid());

drop policy if exists "scheduled_chat_messages_insert_own" on public.scheduled_chat_messages;
create policy "scheduled_chat_messages_insert_own"
  on public.scheduled_chat_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.id = thread_id and (t.user_a = auth.uid() or t.user_b = auth.uid())
    )
  );

drop policy if exists "scheduled_chat_messages_delete_own" on public.scheduled_chat_messages;
create policy "scheduled_chat_messages_delete_own"
  on public.scheduled_chat_messages
  for delete
  to authenticated
  using (sender_id = auth.uid() and sent_at is null);

create or replace function public.dispatch_due_scheduled_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_count integer := 0;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  with due as (
    select s.*
    from public.scheduled_chat_messages s
    where s.sender_id = v_me
      and s.sent_at is null
      and s.scheduled_for <= now()
    order by s.scheduled_for asc
    for update skip locked
  ),
  inserted as (
    insert into public.chat_messages (
      thread_id, sender_id, body, message_type, snap_id, media_path, metadata, scheduled_for
    )
    select d.thread_id, d.sender_id, d.body, d.message_type, d.snap_id, d.media_path, d.metadata, d.scheduled_for
    from due d
    returning id
  ),
  marked as (
    update public.scheduled_chat_messages s
    set sent_at = now()
    where s.id in (select d.id from due d)
    returning s.id
  )
  select count(*) into v_count from marked;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.dispatch_due_scheduled_messages() to authenticated;

-- -----------------------------------------------------------------------------
-- Sensitive snaps + screenshot hint events
-- -----------------------------------------------------------------------------
alter table public.snaps
  add column if not exists is_sensitive boolean not null default false;

create table if not exists public.snap_screenshot_events (
  id uuid primary key default gen_random_uuid(),
  snap_id uuid not null references public.snaps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text null,
  created_at timestamptz not null default now()
);

create index if not exists snap_screenshot_events_snap_idx
  on public.snap_screenshot_events (snap_id, created_at desc);

alter table public.snap_screenshot_events enable row level security;

drop policy if exists "snap_screenshot_events_select_participants" on public.snap_screenshot_events;
create policy "snap_screenshot_events_select_participants"
  on public.snap_screenshot_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.snaps s
      where s.id = snap_id
        and (s.sender_id = auth.uid() or s.recipient_id = auth.uid())
    )
  );

drop policy if exists "snap_screenshot_events_insert_recipient" on public.snap_screenshot_events;
create policy "snap_screenshot_events_insert_recipient"
  on public.snap_screenshot_events
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.snaps s
      where s.id = snap_id and s.recipient_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Stories
-- -----------------------------------------------------------------------------
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null,
  media_kind text not null default 'image',
  caption text null,
  is_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_media_kind_check check (media_kind in ('image', 'video'))
);

create index if not exists stories_user_created_idx
  on public.stories (user_id, created_at desc);

create index if not exists stories_expiry_idx
  on public.stories (expires_at);

create table if not exists public.story_views (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  constraint story_views_unique unique (story_id, viewer_id)
);

create index if not exists story_views_story_idx
  on public.story_views (story_id, viewed_at desc);

alter table public.stories enable row level security;
alter table public.story_views enable row level security;

drop policy if exists "stories_select_owner_or_friends" on public.stories;
create policy "stories_select_owner_or_friends"
  on public.stories
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friends f
      where f.user_id = auth.uid() and f.friend_id = stories.user_id
    )
  );

drop policy if exists "stories_insert_own" on public.stories;
create policy "stories_insert_own"
  on public.stories
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "stories_delete_own" on public.stories;
create policy "stories_delete_own"
  on public.stories
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "story_views_select_owner_or_viewer" on public.story_views;
create policy "story_views_select_owner_or_viewer"
  on public.story_views
  for select
  to authenticated
  using (
    viewer_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "story_views_insert_own" on public.story_views;
create policy "story_views_insert_own"
  on public.story_views
  for insert
  to authenticated
  with check (
    viewer_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = story_id
        and s.user_id <> auth.uid()
        and (
          s.user_id = auth.uid()
          or exists (
            select 1 from public.friends f
            where f.user_id = auth.uid() and f.friend_id = s.user_id
          )
        )
    )
  );

create or replace function public.mark_story_viewed(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  insert into public.story_views(story_id, viewer_id)
  values (p_story_id, v_me)
  on conflict (story_id, viewer_id) do nothing;
end;
$$;

grant execute on function public.mark_story_viewed(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Best friends ranking
-- -----------------------------------------------------------------------------
create table if not exists public.best_friends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  rank smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint best_friends_owner_friend_diff check (owner_id <> friend_id),
  constraint best_friends_unique unique (owner_id, friend_id)
);

create index if not exists best_friends_owner_rank_idx
  on public.best_friends(owner_id, rank desc, created_at desc);

alter table public.best_friends enable row level security;

drop policy if exists "best_friends_select_own" on public.best_friends;
create policy "best_friends_select_own"
  on public.best_friends
  for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "best_friends_insert_own_friend" on public.best_friends;
create policy "best_friends_insert_own_friend"
  on public.best_friends
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.friends f
      where f.user_id = auth.uid() and f.friend_id = best_friends.friend_id
    )
  );

drop policy if exists "best_friends_update_own" on public.best_friends;
create policy "best_friends_update_own"
  on public.best_friends
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "best_friends_delete_own" on public.best_friends;
create policy "best_friends_delete_own"
  on public.best_friends
  for delete
  to authenticated
  using (owner_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Group chats
-- -----------------------------------------------------------------------------
create table if not exists public.group_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_thread_members (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.group_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  constraint group_thread_members_role_check check (role in ('owner', 'admin', 'member')),
  constraint group_thread_members_unique unique (thread_id, user_id)
);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.group_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  message_type text not null default 'text',
  media_path text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists group_messages_thread_created_idx
  on public.group_messages(thread_id, created_at desc);

alter table public.group_threads enable row level security;
alter table public.group_thread_members enable row level security;
alter table public.group_messages enable row level security;

drop policy if exists "group_threads_select_member" on public.group_threads;
create policy "group_threads_select_member"
  on public.group_threads
  for select
  to authenticated
  using (
    exists (
      select 1 from public.group_thread_members m
      where m.thread_id = id and m.user_id = auth.uid()
    )
  );

drop policy if exists "group_threads_insert_owner" on public.group_threads;
create policy "group_threads_insert_owner"
  on public.group_threads
  for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "group_thread_members_select_member" on public.group_thread_members;
create policy "group_thread_members_select_member"
  on public.group_thread_members
  for select
  to authenticated
  using (
    exists (
      select 1 from public.group_thread_members m
      where m.thread_id = thread_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "group_messages_select_member" on public.group_messages;
create policy "group_messages_select_member"
  on public.group_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.group_thread_members m
      where m.thread_id = thread_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "group_messages_insert_member" on public.group_messages;
create policy "group_messages_insert_member"
  on public.group_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.group_thread_members m
      where m.thread_id = thread_id and m.user_id = auth.uid()
    )
  );

create or replace function public.create_group_thread(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_thread_id uuid;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'GROUP_TITLE_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.group_threads(owner_id, title)
  values (v_me, trim(p_title))
  returning id into v_thread_id;

  insert into public.group_thread_members(thread_id, user_id, role)
  values (v_thread_id, v_me, 'owner')
  on conflict do nothing;

  insert into public.group_thread_members(thread_id, user_id, role)
  select
    v_thread_id,
    f.friend_id,
    'member'
  from public.friends f
  where f.user_id = v_me
    and f.friend_id = any(coalesce(p_member_ids, '{}'))
    and f.friend_id <> v_me
  on conflict do nothing;

  return v_thread_id;
end;
$$;

grant execute on function public.create_group_thread(text, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Memories favorites
-- -----------------------------------------------------------------------------
create table if not exists public.user_photo_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  photo_id uuid not null references public.user_photos(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_photo_favorites_unique unique (user_id, photo_id)
);

create index if not exists user_photo_favorites_user_idx
  on public.user_photo_favorites(user_id, created_at desc);

alter table public.user_photo_favorites enable row level security;

drop policy if exists "user_photo_favorites_select_own" on public.user_photo_favorites;
create policy "user_photo_favorites_select_own"
  on public.user_photo_favorites
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_photo_favorites_insert_own" on public.user_photo_favorites;
create policy "user_photo_favorites_insert_own"
  on public.user_photo_favorites
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_photos p
      where p.id = photo_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "user_photo_favorites_delete_own" on public.user_photo_favorites;
create policy "user_photo_favorites_delete_own"
  on public.user_photo_favorites
  for delete
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Friendship streak stats
-- -----------------------------------------------------------------------------
create or replace function public.get_friendship_streaks(p_limit integer default 20)
returns table (
  friend_id uuid,
  streak_days integer,
  points integer,
  last_interaction timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
with my_friends as (
  select f.friend_id
  from public.friends f
  where f.user_id = auth.uid()
),
interactions as (
  -- chat interactions with each friend
  select
    case when t.user_a = auth.uid() then t.user_b else t.user_a end as friend_id,
    m.created_at as ts
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  where (t.user_a = auth.uid() or t.user_b = auth.uid())
    and m.sender_id in (auth.uid(), case when t.user_a = auth.uid() then t.user_b else t.user_a end)
  union all
  -- snap interactions with each friend
  select s.recipient_id as friend_id, s.created_at as ts
  from public.snaps s
  where s.sender_id = auth.uid()
  union all
  select s.sender_id as friend_id, s.created_at as ts
  from public.snaps s
  where s.recipient_id = auth.uid()
),
daily as (
  select i.friend_id, (i.ts at time zone 'utc')::date as day_utc, max(i.ts) as last_ts
  from interactions i
  group by i.friend_id, (i.ts at time zone 'utc')::date
),
scored as (
  select
    f.friend_id,
    coalesce((select max(i.ts) from interactions i where i.friend_id = f.friend_id), null) as last_interaction,
    coalesce((select count(*) from interactions i where i.friend_id = f.friend_id and i.ts >= now() - interval '30 days'), 0) as points_base
  from my_friends f
),
streaks as (
  select
    s.friend_id,
    coalesce((
      with recursive r(day_utc, streak, active) as (
        select
          current_date,
          case when exists (
            select 1 from daily d where d.friend_id = s.friend_id and d.day_utc = current_date
          ) then 1 else 0 end,
          exists (
            select 1 from daily d where d.friend_id = s.friend_id and d.day_utc = current_date
          )
        union all
        select
          r.day_utc - 1,
          case when exists (
            select 1 from daily d where d.friend_id = s.friend_id and d.day_utc = r.day_utc - 1
          ) then r.streak + 1 else r.streak end,
          exists (
            select 1 from daily d where d.friend_id = s.friend_id and d.day_utc = r.day_utc - 1
          )
        from r
        where r.active = true and r.day_utc > current_date - 29
      )
      select max(r.streak) from r
    ), 0) as streak_days,
    (s.points_base)::integer as points,
    s.last_interaction
  from scored s
)
select
  st.friend_id,
  st.streak_days,
  st.points,
  st.last_interaction
from streaks st
order by st.streak_days desc, st.points desc, st.last_interaction desc nulls last
limit greatest(coalesce(p_limit, 20), 1);
$$;

grant execute on function public.get_friendship_streaks(integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Storage buckets for new media
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  52428800,
  array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-m4a', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stories-media',
  'stories-media',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

drop policy if exists "chat_media_insert_own" on storage.objects;
create policy "chat_media_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "chat_media_select_own_or_thread_member" on storage.objects;
create policy "chat_media_select_own_or_thread_member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.chat_messages m
        join public.chat_threads t on t.id = m.thread_id
        where m.media_path = name
          and (t.user_a = auth.uid() or t.user_b = auth.uid())
      )
    )
  );

drop policy if exists "chat_media_delete_own" on storage.objects;
create policy "chat_media_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "stories_media_insert_own" on storage.objects;
create policy "stories_media_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'stories-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "stories_media_select_owner_or_friends" on storage.objects;
create policy "stories_media_select_owner_or_friends"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'stories-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.friends f
        where f.user_id = auth.uid()
          and f.friend_id::text = (storage.foldername(name))[1]
      )
    )
  );

drop policy if exists "stories_media_delete_own" on storage.objects;
create policy "stories_media_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'stories-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- Realtime publication additions (idempotent)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_message_reactions'
    ) then
      alter publication supabase_realtime add table public.chat_message_reactions;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stories'
    ) then
      alter publication supabase_realtime add table public.stories;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'story_views'
    ) then
      alter publication supabase_realtime add table public.story_views;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scheduled_chat_messages'
    ) then
      alter publication supabase_realtime add table public.scheduled_chat_messages;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_messages'
    ) then
      alter publication supabase_realtime add table public.group_messages;
    end if;
  end if;
end $$;

commit;
