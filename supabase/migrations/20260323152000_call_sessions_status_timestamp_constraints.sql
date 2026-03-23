-- =============================================================================
-- Enforce call status/timestamp consistency at DB level
-- =============================================================================

update public.call_sessions
set accepted_at = coalesce(accepted_at, created_at),
    started_at = coalesce(started_at, created_at)
where status = 'accepted'
  and (accepted_at is null or started_at is null);

update public.call_sessions
set ended_at = coalesce(ended_at, created_at)
where status in ('ended', 'declined', 'missed', 'cancelled', 'failed')
  and ended_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'call_sessions_accepted_timestamps_check'
      and conrelid = 'public.call_sessions'::regclass
  ) then
    alter table public.call_sessions
      add constraint call_sessions_accepted_timestamps_check
      check (status <> 'accepted' or (accepted_at is not null and started_at is not null));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'call_sessions_terminal_ended_at_check'
      and conrelid = 'public.call_sessions'::regclass
  ) then
    alter table public.call_sessions
      add constraint call_sessions_terminal_ended_at_check
      check (
        status not in ('ended', 'declined', 'missed', 'cancelled', 'failed')
        or ended_at is not null
      );
  end if;
end $$;
