-- RPC: get_user_stats(p_target_user_id) – global messages + snaps + score for a user (only callable by self or a friend)

create or replace function public.get_user_stats(p_target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_messages_total bigint := 0;
  v_snaps_total bigint := 0;
  v_score_total bigint := 0;
begin
  if v_me is null or p_target_user_id is null then
    return jsonb_build_object('messages_total', 0, 'snaps_total', 0, 'score_total', 0);
  end if;

  -- Only allow if caller is the target user or they are friends
  if v_me <> p_target_user_id then
    if not exists (
      select 1 from public.friends f
      where (f.user_id = v_me and f.friend_id = p_target_user_id)
         or (f.user_id = p_target_user_id and f.friend_id = v_me)
    ) then
      return jsonb_build_object('messages_total', 0, 'snaps_total', 0, 'score_total', 0);
    end if;
  end if;

  -- Global stats for p_target_user_id (same logic as get_my_stats)
  select count(*) into v_messages_total
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  where t.user_a = p_target_user_id or t.user_b = p_target_user_id;

  select count(*) into v_snaps_total
  from public.snaps
  where sender_id = p_target_user_id or recipient_id = p_target_user_id;

  v_score_total := coalesce(v_messages_total, 0) + coalesce(v_snaps_total, 0);

  return jsonb_build_object(
    'messages_total', coalesce(v_messages_total, 0),
    'snaps_total', coalesce(v_snaps_total, 0),
    'score_total', v_score_total
  );
end;
$$;
