-- =============================================================================
-- 1:1 Chat (friends only): chat_threads + chat_messages, RPC get_or_create_thread, RLS, Realtime
-- =============================================================================

-- 1) chat_threads: one row per unordered user pair
create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint chat_threads_user_a_b_diff check (user_a <> user_b)
);

create unique index chat_threads_unique_pair
  on public.chat_threads (least(user_a, user_b), greatest(user_a, user_b));

alter table public.chat_threads enable row level security;

-- 2) chat_messages
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index chat_messages_thread_created_idx
  on public.chat_messages (thread_id, created_at);

create index chat_messages_sender_id_idx
  on public.chat_messages (sender_id);

alter table public.chat_messages enable row level security;

-- 3) RPC: get_or_create_thread(other_user_id uuid) – SECURITY DEFINER, friends only
create or replace function public.get_or_create_thread(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_thread_id uuid;
  v_lo uuid;
  v_hi uuid;
begin
  if v_me is null or other_user_id is null then
    raise exception 'Not authenticated or invalid other_user_id.';
  end if;
  if v_me = other_user_id then
    raise exception 'Cannot open a chat with yourself.';
  end if;

  -- Ensure both users are friends (friends table has user_id, friend_id; both directions exist)
  if not exists (
    select 1 from public.friends f
    where f.user_id = v_me and f.friend_id = other_user_id
  ) then
    raise exception 'Only friends can open a chat.';
  end if;

  v_lo := least(v_me, other_user_id);
  v_hi := greatest(v_me, other_user_id);

  select id into v_thread_id
  from public.chat_threads
  where least(user_a, user_b) = v_lo and greatest(user_a, user_b) = v_hi
  limit 1;

  if v_thread_id is not null then
    return v_thread_id;
  end if;

  insert into public.chat_threads (user_a, user_b)
  values (v_lo, v_hi)
  returning id into v_thread_id;

  return v_thread_id;
end;
$$;

comment on function public.get_or_create_thread(uuid) is
  'Returns thread_id for the 1:1 chat with other_user_id. Creates thread if missing. Only friends. SECURITY DEFINER.';

grant execute on function public.get_or_create_thread(uuid) to authenticated;

-- 4) RLS chat_threads: SELECT if participant; no direct INSERT (use RPC)
create policy "chat_threads_select_participant"
  on public.chat_threads for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

-- 5) RLS chat_messages: SELECT/INSERT if participant in thread
create policy "chat_messages_select_participant"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.chat_threads t
      where t.id = thread_id and (t.user_a = auth.uid() or t.user_b = auth.uid())
    )
  );

create policy "chat_messages_insert_sender_in_thread"
  on public.chat_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.id = thread_id and (t.user_a = auth.uid() or t.user_b = auth.uid())
    )
  );

-- 6) Realtime for chat_messages
alter publication supabase_realtime add table public.chat_messages;
