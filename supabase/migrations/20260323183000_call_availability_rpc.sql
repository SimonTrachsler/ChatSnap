-- =============================================================================
-- RPC: get_call_availability
-- - gives a friend-safe availability signal before starting a call
-- - runs as SECURITY DEFINER so it can evaluate call_sessions beyond caller RLS
-- =============================================================================

create or replace function public.get_call_availability(p_target_user_id uuid)
returns table(available boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := auth.uid();
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

  if exists (
    select 1
    from public.call_sessions s
    where s.status in ('ringing', 'accepted')
      and (s.caller_id = requester_id or s.callee_id = requester_id)
  ) then
    return query select false, 'you_busy';
    return;
  end if;

  if exists (
    select 1
    from public.call_sessions s
    where s.status in ('ringing', 'accepted')
      and (s.caller_id = p_target_user_id or s.callee_id = p_target_user_id)
  ) then
    return query select false, 'target_busy';
    return;
  end if;

  return query select true, 'available';
end;
$$;

revoke all on function public.get_call_availability(uuid) from public;
grant execute on function public.get_call_availability(uuid) to authenticated;

comment on function public.get_call_availability(uuid) is
  'Returns call availability signal for requester vs target (friends-only).';
