-- RPC: get_discover_users(p_limit) – random profiles excluding self, friends, and pending requests

create or replace function public.get_discover_users(p_limit int default 20)
returns table(id uuid, username text, avatar_url text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.username, p.avatar_url
  from public.profiles p
  where p.id != auth.uid()
  and not exists (
    select 1 from public.friends f
    where (f.user_id = auth.uid() and f.friend_id = p.id)
       or (f.user_id = p.id and f.friend_id = auth.uid())
  )
  and not exists (
    select 1 from public.friend_requests r
    where r.status = 'pending'
      and ((r.requester_id = auth.uid() and r.receiver_id = p.id)
           or (r.receiver_id = auth.uid() and r.requester_id = p.id))
  )
  order by random()
  limit p_limit;
$$;
