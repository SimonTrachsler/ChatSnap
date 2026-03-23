-- =============================================================================
-- public.messages: 1:1 chat messages
-- - sender_id, receiver_id reference profiles(id)
-- - Index on (sender_id, receiver_id, created_at) for conversation queries
-- =============================================================================

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_sender_receiver_diff check (sender_id <> receiver_id)
);

create index messages_sender_receiver_created_at_idx
  on public.messages (sender_id, receiver_id, created_at);

alter table public.messages enable row level security;

-- Read: only sender or receiver
create policy "messages_select_own"
  on public.messages for select
  to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

-- Insert: only as sender
create policy "messages_insert_sender"
  on public.messages for insert
  to authenticated
  with check (sender_id = auth.uid());

comment on table public.messages is '1:1 chat messages between users (profiles).';
