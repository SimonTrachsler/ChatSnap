begin;

alter table public.group_threads
  add column if not exists avatar_url text null;

create or replace function public.create_group_thread_v2(
  p_title text,
  p_member_ids uuid[],
  p_avatar_url text default null
)
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

  insert into public.group_threads(owner_id, title, avatar_url)
  values (v_me, trim(p_title), nullif(trim(coalesce(p_avatar_url, '')), ''))
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

grant execute on function public.create_group_thread_v2(text, uuid[], text) to authenticated;

create or replace function public.create_group_thread(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_group_thread_v2(p_title, p_member_ids, null);
end;
$$;

grant execute on function public.create_group_thread(text, uuid[]) to authenticated;

create or replace function public.add_group_thread_member(
  p_thread_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_role text;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if p_thread_id is null or p_user_id is null then
    raise exception 'GROUP_INVALID_MEMBER_INPUT' using errcode = 'P0001';
  end if;

  select m.role
  into v_role
  from public.group_thread_members m
  where m.thread_id = p_thread_id
    and m.user_id = v_me
  limit 1;

  if v_role not in ('owner', 'admin') then
    raise exception 'GROUP_NOT_ADMIN' using errcode = 'P0001';
  end if;

  if p_user_id = v_me then
    return;
  end if;

  if not exists (
    select 1
    from public.friends f
    where f.user_id = v_me
      and f.friend_id = p_user_id
  ) then
    raise exception 'GROUP_MEMBER_MUST_BE_FRIEND' using errcode = 'P0001';
  end if;

  insert into public.group_thread_members(thread_id, user_id, role)
  values (p_thread_id, p_user_id, 'member')
  on conflict do nothing;
end;
$$;

grant execute on function public.add_group_thread_member(uuid, uuid) to authenticated;

create or replace function public.remove_group_thread_member(
  p_thread_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_role text;
  v_target_role text;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if p_thread_id is null or p_user_id is null then
    raise exception 'GROUP_INVALID_MEMBER_INPUT' using errcode = 'P0001';
  end if;

  select m.role
  into v_role
  from public.group_thread_members m
  where m.thread_id = p_thread_id
    and m.user_id = v_me
  limit 1;

  if p_user_id = v_me then
    if v_role is null then
      return;
    end if;
    if v_role = 'owner' then
      raise exception 'GROUP_OWNER_CANNOT_LEAVE' using errcode = 'P0001';
    end if;
    delete from public.group_thread_members
    where thread_id = p_thread_id
      and user_id = v_me;
    return;
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'GROUP_NOT_ADMIN' using errcode = 'P0001';
  end if;

  select m.role
  into v_target_role
  from public.group_thread_members m
  where m.thread_id = p_thread_id
    and m.user_id = p_user_id
  limit 1;

  if v_target_role is null then
    return;
  end if;

  if v_target_role = 'owner' then
    raise exception 'GROUP_OWNER_CANNOT_BE_REMOVED' using errcode = 'P0001';
  end if;

  if v_role = 'admin' and v_target_role = 'admin' then
    raise exception 'GROUP_ADMIN_CANNOT_REMOVE_ADMIN' using errcode = 'P0001';
  end if;

  delete from public.group_thread_members
  where thread_id = p_thread_id
    and user_id = p_user_id;
end;
$$;

grant execute on function public.remove_group_thread_member(uuid, uuid) to authenticated;

commit;