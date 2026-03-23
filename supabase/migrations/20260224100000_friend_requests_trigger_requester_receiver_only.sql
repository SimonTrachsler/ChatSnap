-- =============================================================================
-- friend_requests: trigger uses requester_id / receiver_id only
-- - Fixes runtime error: record "old" has no field "to_user"
-- - Assumes current schema with requester_id and receiver_id columns
-- - Does NOT reset data or change table structure
-- =============================================================================

drop trigger if exists friend_requests_receiver_update_only_status
  on public.friend_requests;

create or replace function public.friend_requests_receiver_update_only_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Authorization: only receiver or requester may update
  if auth.uid() = old.receiver_id then
    -- Receiver may set status to accepted or rejected
    if new.status is null or new.status not in ('accepted', 'rejected') then
      raise exception 'Receiver may only set status to accepted or rejected.';
    end if;
  elsif auth.uid() = old.requester_id then
    -- Requester may set status only to rejected (withdraw)
    if new.status is null or new.status <> 'rejected' then
      raise exception 'Requester may only set status to rejected (withdraw).';
    end if;
  else
    raise exception 'Only the receiver or requester can update a friend request.';
  end if;

  -- Only status changes are allowed; ids and participants are immutable
  if old.requester_id is distinct from new.requester_id
     or old.receiver_id is distinct from new.receiver_id
     or old.id is distinct from new.id then
    raise exception 'Only status can be updated.';
  end if;

  return new;
end;
$fn$;

create trigger friend_requests_receiver_update_only_status
  before update on public.friend_requests
  for each row
  execute function public.friend_requests_receiver_update_only_status();

