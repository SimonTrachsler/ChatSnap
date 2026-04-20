begin;

create extension if not exists pg_trgm;

create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (username gin_trgm_ops);

create index if not exists profiles_created_at_desc_idx
  on public.profiles (created_at desc);

create index if not exists friends_user_friend_idx
  on public.friends (user_id, friend_id);

create index if not exists friend_requests_pending_requester_receiver_idx
  on public.friend_requests (requester_id, receiver_id)
  where status = 'pending';

create index if not exists friend_requests_pending_receiver_requester_idx
  on public.friend_requests (receiver_id, requester_id)
  where status = 'pending';

create or replace function public.get_discover_users(p_limit int default 20)
returns table(id uuid, username text, avatar_url text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.username, p.avatar_url
  from public.profiles p
  where p.id != auth.uid()
    and not exists (
      select 1
      from public.friends f
      where (f.user_id = auth.uid() and f.friend_id = p.id)
         or (f.user_id = p.id and f.friend_id = auth.uid())
    )
    and not exists (
      select 1
      from public.friend_requests r
      where r.status = 'pending'
        and (
          (r.requester_id = auth.uid() and r.receiver_id = p.id)
          or (r.receiver_id = auth.uid() and r.requester_id = p.id)
        )
    )
  order by p.created_at desc nulls last
  limit greatest(coalesce(p_limit, 20), 1);
$$;

comment on function public.get_discover_users(int) is
  'Fast discover query: excludes self/friends/pending requests; newest profiles first.';

commit;
