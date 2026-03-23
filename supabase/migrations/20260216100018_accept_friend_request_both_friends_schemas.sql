-- =============================================================================
-- accept_friend_request: works with friends (user_id, friend_id) OR (user_a, user_b).
-- =============================================================================

create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requester_id uuid;
  v_me uuid := auth.uid();
begin
  select fr.requester_id into v_requester_id
  from public.friend_requests fr
  where fr.id = request_id
    and fr.receiver_id = v_me
    and fr.status = 'pending';

  if v_requester_id is null then
    raise exception 'Friend request not found or already processed.';
  end if;

  update public.friend_requests
  set status = 'accepted'
  where id = request_id and receiver_id = v_me and status = 'pending';

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friends' and column_name = 'user_id') then
    insert into public.friends (user_id, friend_id)
    values (v_me, v_requester_id), (v_requester_id, v_me)
    on conflict (user_id, friend_id) do nothing;
  elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friends' and column_name = 'user_a') then
    insert into public.friends (user_a, user_b)
    values (least(v_me, v_requester_id), greatest(v_me, v_requester_id))
    on conflict (user_a, user_b) do nothing;
  else
    raise exception 'friends table has no user_id or user_a column.';
  end if;
end;
$$;

comment on function public.accept_friend_request(uuid) is
  'Accepts a pending friend request: sets status = accepted and inserts into friends. Supports both user_id/friend_id and user_a/user_b schema.';

grant execute on function public.accept_friend_request(uuid) to authenticated;
