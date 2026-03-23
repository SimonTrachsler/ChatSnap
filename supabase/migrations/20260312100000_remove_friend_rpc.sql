-- remove_friend: löscht Freundschaft für auth.uid() und friend_id (beide Zeilen)
create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_friend_id is null or p_friend_id = auth.uid() then
    return;
  end if;
  delete from public.friends
  where (user_id = auth.uid() and friend_id = p_friend_id)
     or (user_id = p_friend_id and friend_id = auth.uid());
end;
$$;
comment on function public.remove_friend(uuid) is 'Removes friendship between auth.uid() and p_friend_id (both rows).';
grant execute on function public.remove_friend(uuid) to authenticated;
