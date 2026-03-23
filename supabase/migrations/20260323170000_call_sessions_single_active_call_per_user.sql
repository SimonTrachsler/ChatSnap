-- =============================================================================
-- Ensure a user can be in only one active call at a time
-- =============================================================================

create or replace function public.call_sessions_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('ringing', 'accepted') then
    -- Serialize inserts touching either participant to avoid race conditions.
    perform pg_advisory_xact_lock(hashtext(new.caller_id::text));
    perform pg_advisory_xact_lock(hashtext(new.callee_id::text));

    if exists (
      select 1
      from public.call_sessions s
      where s.status in ('ringing', 'accepted')
        and (
          s.caller_id in (new.caller_id, new.callee_id)
          or s.callee_id in (new.caller_id, new.callee_id)
        )
    ) then
      raise exception 'One of the participants is already in an active call.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists call_sessions_before_insert on public.call_sessions;

create trigger call_sessions_before_insert
  before insert on public.call_sessions
  for each row
  execute function public.call_sessions_before_insert();

comment on function public.call_sessions_before_insert() is
  'Prevents creating active calls when either participant is already in an active call.';
