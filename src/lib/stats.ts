import { callRpc } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type FriendStats = {
  messages_total: number;
  snaps_total: number;
  score_total: number;
};

export type MyStats = {
  messages_total: number;
  snaps_total: number;
  score_total: number;
};

export type UserStats = {
  messages_total: number;
  snaps_total: number;
  score_total: number;
};

type StatsRpcResult =
  | Database['public']['Functions']['get_user_stats']['Returns']
  | Database['public']['Functions']['get_friend_stats']['Returns']
  | Database['public']['Functions']['get_my_stats']['Returns']
  | null
  | undefined;

function normalizeStats(raw: StatsRpcResult): UserStats {
  return {
    messages_total: Number(raw?.messages_total) || 0,
    snaps_total: Number(raw?.snaps_total) || 0,
    score_total: Number(raw?.score_total) || 0,
  };
}

export async function getUserStats(targetUserId: string): Promise<UserStats> {
  const { data, error } = await callRpc<Database['public']['Functions']['get_user_stats']['Returns']>('get_user_stats', {
    p_target_user_id: targetUserId,
  });
  if (error) {
    console.error('[stats] get_user_stats error:', error.message);
    return { messages_total: 0, snaps_total: 0, score_total: 0 };
  }
  return normalizeStats(data);
}

export async function getFriendStats(otherUserId: string): Promise<FriendStats> {
  const { data, error } = await callRpc<Database['public']['Functions']['get_friend_stats']['Returns']>('get_friend_stats', {
    p_other_user_id: otherUserId,
  });
  if (error) {
    console.error('[stats] get_friend_stats error:', error.message);
    return { messages_total: 0, snaps_total: 0, score_total: 0 };
  }
  return normalizeStats(data);
}

export async function getMyStats(): Promise<MyStats> {
  const { data, error } = await callRpc<Database['public']['Functions']['get_my_stats']['Returns']>('get_my_stats');
  if (error) {
    console.error('[stats] get_my_stats error:', error.message);
    return { messages_total: 0, snaps_total: 0, score_total: 0 };
  }
  return normalizeStats(data);
}
