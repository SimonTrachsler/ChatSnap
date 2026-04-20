begin;

create index if not exists chat_threads_user_a_idx
  on public.chat_threads (user_a);

create index if not exists chat_threads_user_b_idx
  on public.chat_threads (user_b);

create index if not exists group_thread_members_user_joined_idx
  on public.group_thread_members (user_id, joined_at desc);

create or replace function public.list_threads_with_preview(p_limit integer default 50)
returns table (
  thread_id uuid,
  other_user_id uuid,
  other_username text,
  other_avatar_url text,
  preview_text text,
  last_at timestamptz,
  last_type text,
  last_snap_opened boolean,
  has_unread boolean
)
language sql
stable
security definer
set search_path = public
as $$
with my_threads as (
  select
    t.id,
    t.created_at,
    case when t.user_a = auth.uid() then t.user_b else t.user_a end as other_user_id
  from public.chat_threads t
  where t.user_a = auth.uid() or t.user_b = auth.uid()
),
enriched as (
  select
    mt.id as thread_id,
    mt.other_user_id,
    p.username as other_username,
    p.avatar_url as other_avatar_url,
    lm.body as last_body,
    lm.created_at as last_message_at,
    coalesce(lm.message_type, 'text') as last_message_type,
    lm.snap_id as last_snap_id,
    mt.created_at as thread_created_at,
    exists (
      select 1
      from public.chat_messages um
      where um.thread_id = mt.id
        and um.read_at is null
        and um.sender_id <> auth.uid()
    ) as has_unread
  from my_threads mt
  left join public.profiles p
    on p.id = mt.other_user_id
  left join lateral (
    select m.body, m.created_at, m.message_type, m.snap_id
    from public.chat_messages m
    where m.thread_id = mt.id
    order by m.created_at desc
    limit 1
  ) lm on true
)
select
  e.thread_id,
  e.other_user_id,
  e.other_username,
  e.other_avatar_url,
  case
    when e.last_message_type = 'snap' and e.last_snap_id is not null then
      case when coalesce(s.opened, false) then 'opened' else 'Snap to open' end
    else coalesce(trim(e.last_body), '')
  end as preview_text,
  coalesce(e.last_message_at, e.thread_created_at) as last_at,
  case when e.last_message_type = 'snap' and e.last_snap_id is not null then 'snap' else 'text' end as last_type,
  case when e.last_message_type = 'snap' and e.last_snap_id is not null then coalesce(s.opened, false) else null end as last_snap_opened,
  e.has_unread
from enriched e
left join public.snaps s
  on s.id = e.last_snap_id
order by coalesce(e.last_message_at, e.thread_created_at) desc
limit greatest(coalesce(p_limit, 50), 1);
$$;

grant execute on function public.list_threads_with_preview(integer) to authenticated;

create or replace function public.list_group_threads_with_preview(p_limit integer default 50)
returns table (
  id uuid,
  title text,
  owner_id uuid,
  avatar_url text,
  created_at timestamptz,
  member_count integer,
  last_message_body text,
  last_message_at timestamptz,
  last_sender_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
with my_groups as (
  select gt.id, gt.title, gt.owner_id, gt.avatar_url, gt.created_at
  from public.group_threads gt
  join public.group_thread_members me
    on me.thread_id = gt.id
   and me.user_id = auth.uid()
)
select
  g.id,
  g.title,
  g.owner_id,
  g.avatar_url,
  g.created_at,
  coalesce(mc.member_count, 0)::integer as member_count,
  lm.body as last_message_body,
  lm.created_at as last_message_at,
  lm.sender_id as last_sender_id
from my_groups g
left join lateral (
  select count(*) as member_count
  from public.group_thread_members m
  where m.thread_id = g.id
) mc on true
left join lateral (
  select gm.body, gm.created_at, gm.sender_id
  from public.group_messages gm
  where gm.thread_id = g.id
  order by gm.created_at desc
  limit 1
) lm on true
order by coalesce(lm.created_at, g.created_at) desc
limit greatest(coalesce(p_limit, 50), 1);
$$;

grant execute on function public.list_group_threads_with_preview(integer) to authenticated;

commit;