-- Remove audio call feature schema and realtime wiring.

begin;

drop function if exists public.get_call_availability(uuid);
drop function if exists public.refresh_call_presence(uuid);

do $$
begin
  if to_regclass('public.call_sessions') is not null then
    execute 'drop trigger if exists call_sessions_after_change_sync_presence on public.call_sessions';
    execute 'drop trigger if exists call_sessions_before_insert on public.call_sessions';
    execute 'drop trigger if exists call_sessions_before_update on public.call_sessions';
  end if;
end $$;

drop function if exists public.call_sessions_after_change_sync_presence();
drop function if exists public.call_sessions_before_insert();
drop function if exists public.call_sessions_before_update();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime drop table public.call_presence;
    exception
      when undefined_table then null;
      when undefined_object then null;
      when invalid_object_definition then null;
    end;

    begin
      alter publication supabase_realtime drop table public.call_sessions;
    exception
      when undefined_table then null;
      when undefined_object then null;
      when invalid_object_definition then null;
    end;
  end if;
end $$;

drop table if exists public.call_presence;
drop table if exists public.call_sessions;

commit;
