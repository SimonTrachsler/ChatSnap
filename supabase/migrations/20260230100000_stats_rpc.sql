-- RPC: get_friend_stats(p_other_user_id) – messages + snaps + score with a friend
-- RPC: get_my_stats() – total messages + snaps + score for auth.uid()

create or replace function public.get_friend_stats(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_thread_id uuid;
  v_messages_total bigint := 0;
  v_snaps_total bigint := 0;
  v_score_total bigint := 0;
begin
  if v_me is null or p_other_user_id is null then
    return jsonb_build_object('messages_total', 0, 'snaps_total', 0, 'score_total', 0);
  end if;
  if v_me = p_other_user_id then
    return jsonb_build_object('messages_total', 0, 'snaps_total', 0, 'score_total', 0);
  end if;

  -- Must be friends
  if not exists (
    select 1 from public.friends f
    where (f.user_id = v_me and f.friend_id = p_other_user_id)
       or (f.user_id = p_other_user_id and f.friend_id = v_me)
  ) then
    return jsonb_build_object('messages_total', 0, 'snaps_total', 0, 'score_total', 0);
  end if;

  -- Thread for (v_me, p_other_user_id)
  select id into v_thread_id
  from public.chat_threads
  where least(user_a, user_b) = least(v_me, p_other_user_id)
    and greatest(user_a, user_b) = greatest(v_me, p_other_user_id)
  limit 1;

  if v_thread_id is not null then
    select count(*) into v_messages_total
    from public.chat_messages
    where thread_id = v_thread_id;
  end if;

  select count(*) into v_snaps_total
  from public.snaps
  where (sender_id = v_me and recipient_id = p_other_user_id)
     or (sender_id = p_other_user_id and recipient_id = v_me);

  v_score_total := coalesce(v_messages_total, 0) + coalesce(v_snaps_total, 0);

  return jsonb_build_object(
    'messages_total', coalesce(v_messages_total, 0),
    'snaps_total', coalesce(v_snaps_total, 0),
    'score_total', v_score_total
  );
end;
$$;

create or replace function public.get_my_stats()
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
  if v_me is null then
    return jsonb_build_object('messages_total', 0, 'snaps_total', 0, 'score_total', 0);
  end if;

  select count(*) into v_messages_total
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  where t.user_a = v_me or t.user_b = v_me;

  select count(*) into v_snaps_total
  from public.snaps
  where sender_id = v_me or recipient_id = v_me;

  v_score_total := coalesce(v_messages_total, 0) + coalesce(v_snaps_total, 0);

  return jsonb_build_object(
    'messages_total', coalesce(v_messages_total, 0),
    'snaps_total', coalesce(v_snaps_total, 0),
    'score_total', v_score_total
  );
end;
$$;
