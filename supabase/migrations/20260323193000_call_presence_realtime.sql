-- =============================================================================
-- Realtime call presence per user
-- - keeps a friend-safe busy flag in sync with active call sessions
-- - enables instant availability updates in chat via realtime subscriptions
-- =============================================================================

create table if not exists public.call_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  is_in_call boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists call_presence_is_in_call_idx
  on public.call_presence (is_in_call, updated_at desc);

alter table public.call_presence enable row level security;

drop policy if exists "call_presence_select_self_or_friends" on public.call_presence;

create policy "call_presence_select_self_or_friends"
  on public.call_presence for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.friends f
      where f.user_id = auth.uid()
        and f.friend_id = call_presence.user_id
    )
  );

create or replace function public.refresh_call_presence(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_busy boolean;
begin
  if p_user_id is null then
    return;
  end if;

  select exists (
    select 1
    from public.call_sessions s
    where s.status in ('ringing', 'accepted')
      and (s.caller_id = p_user_id or s.callee_id = p_user_id)
  ) into next_busy;

  insert into public.call_presence (user_id, is_in_call, updated_at)
  values (p_user_id, next_busy, now())
  on conflict (user_id) do update
    set is_in_call = excluded.is_in_call,
        updated_at = now();
end;
$$;

create or replace function public.call_sessions_after_change_sync_presence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.refresh_call_presence(new.caller_id);
    perform public.refresh_call_presence(new.callee_id);
  elsif tg_op = 'UPDATE' then
    perform public.refresh_call_presence(old.caller_id);
    perform public.refresh_call_presence(old.callee_id);
    if new.caller_id is distinct from old.caller_id then
      perform public.refresh_call_presence(new.caller_id);
    end if;
    if new.callee_id is distinct from old.callee_id then
      perform public.refresh_call_presence(new.callee_id);
    end if;
  elsif tg_op = 'DELETE' then
    perform public.refresh_call_presence(old.caller_id);
    perform public.refresh_call_presence(old.callee_id);
  end if;

  return null;
end;
$$;

drop trigger if exists call_sessions_after_change_sync_presence on public.call_sessions;

create trigger call_sessions_after_change_sync_presence
  after insert or update or delete on public.call_sessions
  for each row
  execute function public.call_sessions_after_change_sync_presence();

insert into public.call_presence (user_id, is_in_call, updated_at)
select
  p.id,
  exists (
    select 1
    from public.call_sessions s
    where s.status in ('ringing', 'accepted')
      and (s.caller_id = p.id or s.callee_id = p.id)
  ) as is_in_call,
  now()
from public.profiles p
on conflict (user_id) do update
  set is_in_call = excluded.is_in_call,
      updated_at = now();

do $$
begin
  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname = 'call_presence'
  ) then
    alter publication supabase_realtime add table public.call_presence;
  end if;
end $$;

create or replace function public.get_call_availability(p_target_user_id uuid)
returns table(available boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := auth.uid();
  requester_busy boolean;
  target_busy boolean;
begin
  if requester_id is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  if p_target_user_id is null then
    return query select false, 'missing_target';
    return;
  end if;

  if requester_id = p_target_user_id then
    return query select false, 'self';
    return;
  end if;

  if not exists (
    select 1
    from public.friends f
    where f.user_id = requester_id
      and f.friend_id = p_target_user_id
  ) then
    return query select false, 'not_friends';
    return;
  end if;

  perform public.refresh_call_presence(requester_id);
  perform public.refresh_call_presence(p_target_user_id);

  if exists (
    select 1
    from public.call_sessions s
    where s.status in ('ringing', 'accepted')
      and (
        (s.caller_id = requester_id and s.callee_id = p_target_user_id)
        or (s.caller_id = p_target_user_id and s.callee_id = requester_id)
      )
  ) then
    return query select false, 'already_with_you';
    return;
  end if;

  select cp.is_in_call
  into requester_busy
  from public.call_presence cp
  where cp.user_id = requester_id;

  requester_busy := coalesce(requester_busy, false);
  if requester_busy then
    return query select false, 'you_busy';
    return;
  end if;

  select cp.is_in_call
  into target_busy
  from public.call_presence cp
  where cp.user_id = p_target_user_id;

  target_busy := coalesce(target_busy, false);
  if target_busy then
    return query select false, 'target_busy';
    return;
  end if;

  return query select true, 'available';
end;
$$;

revoke all on function public.get_call_availability(uuid) from public;
grant execute on function public.get_call_availability(uuid) to authenticated;

comment on table public.call_presence is
  'Friend-safe realtime call busy flag per user.';
