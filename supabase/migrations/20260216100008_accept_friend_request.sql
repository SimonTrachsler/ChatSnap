-- Accept friend request in a single transaction:
-- 1) Update friend_requests.status = 'accepted'
-- 2) Insert into friends (current_user, requester) and (requester, current_user)
-- Duplicates prevented by unique (user_id, friend_id) with ON CONFLICT DO NOTHING.

create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requester_id uuid;
begin
  select fr.requester_id into v_requester_id
  from public.friend_requests fr
  where fr.id = request_id
    and fr.receiver_id = auth.uid()
    and fr.status = 'pending';

  if v_requester_id is null then
    raise exception 'Friend request not found or already processed.';
  end if;

  update public.friend_requests
  set status = 'accepted'
  where id = request_id and receiver_id = auth.uid() and status = 'pending';

  insert into public.friends (user_id, friend_id)
  values (auth.uid(), v_requester_id), (v_requester_id, auth.uid())
  on conflict (user_id, friend_id) do nothing;
end;
$$;

comment on function public.accept_friend_request(uuid) is
  'Accepts a pending friend request: sets status to accepted and inserts both friends rows. Idempotent for friends insert (ON CONFLICT DO NOTHING).';

grant execute on function public.accept_friend_request(uuid) to authenticated;
