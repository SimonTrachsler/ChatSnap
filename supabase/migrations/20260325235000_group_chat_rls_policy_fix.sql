begin;

create or replace function public.is_group_member(
  p_thread_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_thread_members m
    where m.thread_id = p_thread_id
      and m.user_id = p_user_id
  );
$$;

grant execute on function public.is_group_member(uuid, uuid) to authenticated;

drop policy if exists "group_threads_select_member" on public.group_threads;
create policy "group_threads_select_member"
  on public.group_threads
  for select
  to authenticated
  using (public.is_group_member(id, auth.uid()));

drop policy if exists "group_thread_members_select_member" on public.group_thread_members;
create policy "group_thread_members_select_member"
  on public.group_thread_members
  for select
  to authenticated
  using (public.is_group_member(group_thread_members.thread_id, auth.uid()));

drop policy if exists "group_messages_select_member" on public.group_messages;
create policy "group_messages_select_member"
  on public.group_messages
  for select
  to authenticated
  using (public.is_group_member(group_messages.thread_id, auth.uid()));

drop policy if exists "group_messages_insert_member" on public.group_messages;
create policy "group_messages_insert_member"
  on public.group_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_group_member(group_messages.thread_id, auth.uid())
  );

commit;

