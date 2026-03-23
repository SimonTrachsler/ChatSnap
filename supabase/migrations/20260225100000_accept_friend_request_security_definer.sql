-- =============================================================================
-- accept_friend_request: SECURITY DEFINER so INSERT into friends bypasses RLS
-- and both rows (receiver,requester) and (requester,receiver) are written.
-- Same logic as before; only friends (user_id, friend_id) schema is used.
-- =============================================================================

create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security definer
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

  insert into public.friends (user_id, friend_id)
  values (v_me, v_requester_id), (v_requester_id, v_me)
  on conflict (user_id, friend_id) do nothing;
end;
$$;

comment on function public.accept_friend_request(uuid) is
  'Accepts a pending friend request: sets status = accepted and inserts both friends rows. Runs as definer so RLS does not block inserts.';

grant execute on function public.accept_friend_request(uuid) to authenticated;
