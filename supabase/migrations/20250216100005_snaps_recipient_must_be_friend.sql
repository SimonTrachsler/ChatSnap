-- =============================================================================
-- Snaps: only allow sending to accepted friends
-- =============================================================================
-- Enforce that (sender_id, recipient_id) exists in friends (in either order).
-- =============================================================================

create or replace function public.snaps_recipient_must_be_friend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid_a uuid;
  uid_b uuid;
begin
  uid_a := least(new.sender_id, new.recipient_id);
  uid_b := greatest(new.sender_id, new.recipient_id);
  if not exists (
    select 1 from public.friends f
    where f.user_a = uid_a and f.user_b = uid_b
  ) then
    raise exception 'Snaps können nur an angenommene Freunde gesendet werden.';
  end if;
  return new;
end;
$$;

comment on function public.snaps_recipient_must_be_friend() is
  'Ensures snap recipient is an accepted friend of the sender.';

drop trigger if exists snaps_recipient_must_be_friend on public.snaps;
create trigger snaps_recipient_must_be_friend
  before insert on public.snaps
  for each row
  execute function public.snaps_recipient_must_be_friend();
