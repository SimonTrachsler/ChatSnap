-- =============================================================================
-- Audio call signaling (MVP): call_sessions
-- - 1:1 call sessions between friends
-- - Realtime updates for ringing/accepted/ended status
-- - RLS: only caller/callee can read/update; caller can create
-- =============================================================================

create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  caller_id uuid not null references public.profiles (id) on delete cascade,
  callee_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'agora',
  rtc_channel text not null,
  status text not null default 'ringing',
  created_at timestamptz not null default now(),
  accepted_at timestamptz null,
  started_at timestamptz null,
  ended_at timestamptz null,
  constraint call_sessions_status_check check (status in ('ringing', 'accepted', 'declined', 'ended', 'missed', 'cancelled', 'failed')),
  constraint call_sessions_participants_diff check (caller_id <> callee_id)
);

create index if not exists call_sessions_callee_status_idx
  on public.call_sessions (callee_id, status, created_at desc);

create index if not exists call_sessions_thread_created_idx
  on public.call_sessions (thread_id, created_at desc);

create unique index if not exists call_sessions_active_pair_idx
  on public.call_sessions (least(caller_id, callee_id), greatest(caller_id, callee_id))
  where status in ('ringing', 'accepted');

alter table public.call_sessions enable row level security;

drop policy if exists "call_sessions_select_own" on public.call_sessions;
drop policy if exists "call_sessions_insert_caller" on public.call_sessions;
drop policy if exists "call_sessions_update_participant" on public.call_sessions;

create policy "call_sessions_select_own"
  on public.call_sessions for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());

create policy "call_sessions_insert_caller"
  on public.call_sessions for insert to authenticated
  with check (
    caller_id = auth.uid()
    and exists (
      select 1 from public.friends f
      where f.user_id = auth.uid() and f.friend_id = callee_id
    )
    and exists (
      select 1
      from public.chat_threads t
      where t.id = thread_id
        and (
          (t.user_a = auth.uid() and t.user_b = callee_id)
          or (t.user_b = auth.uid() and t.user_a = callee_id)
        )
    )
  );

create policy "call_sessions_update_participant"
  on public.call_sessions for update to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid())
  with check (caller_id = auth.uid() or callee_id = auth.uid());

create or replace function public.call_sessions_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.thread_id is distinct from old.thread_id
     or new.caller_id is distinct from old.caller_id
     or new.callee_id is distinct from old.callee_id
     or new.provider is distinct from old.provider
     or new.rtc_channel is distinct from old.rtc_channel
     or new.created_at is distinct from old.created_at then
    raise exception 'Immutable call session fields cannot be changed.';
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

drop trigger if exists call_sessions_before_update on public.call_sessions;

create trigger call_sessions_before_update
  before update on public.call_sessions
  for each row
  execute function public.call_sessions_before_update();

do $$
begin
  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname = 'call_sessions'
  ) then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
end $$;

comment on table public.call_sessions is
  '1:1 audio call signaling sessions (ringing/accepted/ended) for friends.';
