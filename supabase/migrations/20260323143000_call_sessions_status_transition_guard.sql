-- =============================================================================
-- Harden call status transitions and actor permissions
-- - enforce role-aware transitions (caller/callee)
-- - prevent invalid status jumps
-- =============================================================================

create or replace function public.call_sessions_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_id uuid;
  jwt_role text;
  is_service_role boolean;
  actor_is_participant boolean;
begin
  actor_id := auth.uid();
  jwt_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');
  is_service_role := jwt_role in ('service_role', 'supabase_admin');
  actor_is_participant := actor_id is not null and (actor_id = old.caller_id or actor_id = old.callee_id);

  if new.thread_id is distinct from old.thread_id
     or new.caller_id is distinct from old.caller_id
     or new.callee_id is distinct from old.callee_id
     or new.provider is distinct from old.provider
     or new.rtc_channel is distinct from old.rtc_channel
     or new.created_at is distinct from old.created_at then
    raise exception 'Immutable call session fields cannot be changed.';
  end if;

  if new.status is distinct from old.status then
    if old.status in ('declined', 'missed', 'cancelled', 'failed', 'ended') then
      raise exception 'Terminal call status cannot be changed.';
    end if;

    if not actor_is_participant and not is_service_role then
      raise exception 'Only call participants can update call status.';
    end if;

    if old.status = 'ringing' then
      if new.status = 'accepted' then
        if actor_id is distinct from old.callee_id and not is_service_role then
          raise exception 'Only callee can accept a ringing call.';
        end if;
      elsif new.status = 'declined' then
        if actor_id is distinct from old.callee_id and not is_service_role then
          raise exception 'Only callee can decline a ringing call.';
        end if;
      elsif new.status = 'cancelled' then
        if actor_id is distinct from old.caller_id and not is_service_role then
          raise exception 'Only caller can cancel a ringing call.';
        end if;
      elsif new.status in ('missed', 'failed') then
        null;
      else
        raise exception 'Invalid status transition from ringing to %.', new.status;
      end if;
    elsif old.status = 'accepted' then
      if new.status not in ('ended', 'failed') then
        raise exception 'Invalid status transition from accepted to %.', new.status;
      end if;
    else
      raise exception 'Invalid status transition from % to %.', old.status, new.status;
    end if;
  end if;

  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    if new.accepted_at is null then
      new.accepted_at := now();
    end if;
    if new.started_at is null then
      new.started_at := now();
    end if;
  end if;

  if new.status in ('ended', 'declined', 'missed', 'cancelled', 'failed') and new.ended_at is null then
    new.ended_at := now();
  end if;

  return new;
end;
$$;

comment on function public.call_sessions_before_update() is
  'Enforces role-aware call status transitions and immutable fields.';
