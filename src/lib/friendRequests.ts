/**
 * Friend requests and friendships – typed Supabase queries.
 * Schema: friend_requests (requester_id, receiver_id, status), friends (user_id, friend_id).
 * Prevents duplicate pending inserts (23505) by checking relationship state before insert.
 */

import { supabase } from '@/lib/supabase';

export type RelationshipState = 'already_friends' | 'outgoing_pending' | 'incoming_pending' | 'none';

export type IncomingRequestRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  created_at: string;
  requester: { username: string | null; email?: string | null; avatar_url?: string | null } | null;
};

export type FriendRow = {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
  friend: { username: string | null; email: string | null; avatar_url?: string | null } | null;
};

export type FriendListItem = {
  id: string;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
};

type SupabaseError = { message?: string; code?: string; details?: string; hint?: string };

/**
 * Get relationship between current user and another user.
 * Checks friends table and friend_requests (pending only). Declined/non-pending counts as none (re-request allowed).
 */
export async function getRelationshipState(
  currentUserId: string,
  otherUserId: string
): Promise<RelationshipState> {
  if (currentUserId === otherUserId) return 'none';

  const { data: friendRow } = await supabase
    .from('friends')
    .select('id')
    .eq('user_id', currentUserId)
    .eq('friend_id', otherUserId)
    .maybeSingle();

  if (friendRow) return 'already_friends';

  const { data: outgoing } = await supabase
    .from('friend_requests')
    .select('id')
    .eq('requester_id', currentUserId)
    .eq('receiver_id', otherUserId)
    .eq('status', 'pending')
    .maybeSingle();

  if (outgoing) return 'outgoing_pending';

  const { data: incoming } = await supabase
    .from('friend_requests')
    .select('id')
    .eq('receiver_id', currentUserId)
    .eq('requester_id', otherUserId)
    .eq('status', 'pending')
    .maybeSingle();

  if (incoming) return 'incoming_pending';

  return 'none';
}

/**
 * Batch version: resolve relationship states for multiple users in 3 queries total.
 */
export async function getRelationshipStates(
  currentUserId: string,
  otherUserIds: string[],
): Promise<Record<string, RelationshipState>> {
  const ids = otherUserIds.filter((id) => id !== currentUserId);
  if (!ids.length) return {};

  const [friendsRes, outgoingRes, incomingRes] = await Promise.all([
    supabase.from('friends').select('friend_id').eq('user_id', currentUserId).in('friend_id', ids),
    supabase.from('friend_requests').select('receiver_id').eq('requester_id', currentUserId).eq('status', 'pending').in('receiver_id', ids),
    supabase.from('friend_requests').select('requester_id').eq('receiver_id', currentUserId).eq('status', 'pending').in('requester_id', ids),
  ]);

  const friendSet = new Set(
    ((friendsRes.data ?? []) as { friend_id: string }[]).map((r) => r.friend_id),
  );
  const outgoingSet = new Set(
    ((outgoingRes.data ?? []) as { receiver_id: string }[]).map((r) => r.receiver_id),
  );
  const incomingSet = new Set(
    ((incomingRes.data ?? []) as { requester_id: string }[]).map((r) => r.requester_id),
  );

  const result: Record<string, RelationshipState> = {};
  for (const id of ids) {
    if (friendSet.has(id)) result[id] = 'already_friends';
    else if (outgoingSet.has(id)) result[id] = 'outgoing_pending';
    else if (incomingSet.has(id)) result[id] = 'incoming_pending';
    else result[id] = 'none';
  }
  return result;
}

/**
 * Send a friend request. Calls getRelationshipState first; if not 'none', returns without inserting.
 * On 23505 (duplicate pending), returns error with code so UI can show "incoming_exists" or "already_friends".
 */
export async function sendFriendRequest(
  currentUserId: string,
  otherUserId: string
): Promise<{ error: SupabaseError | null }> {
  const state = await getRelationshipState(currentUserId, otherUserId);
  if (state !== 'none') {
    return {
      error: {
        code: 'RELATIONSHIP_EXISTS',
        message:
          state === 'already_friends'
            ? 'Already friends.'
            : state === 'outgoing_pending'
              ? 'Request already sent.'
              : 'This person has already sent you a request.',
      },
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase inferred never for insert
  const { error } = await (supabase.from('friend_requests') as any).insert({
    requester_id: currentUserId,
    receiver_id: otherUserId,
    status: 'pending',
  });
  return { error: error as SupabaseError | null };
}

/**
 * Accept a friend request (receiver only). Updates status and inserts both friends rows.
 */
export async function acceptFriendRequest(requestId: string): Promise<{ error: SupabaseError | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC args inferred as undefined
  const { error } = await (supabase.rpc as any)('accept_friend_request', { request_id: requestId });
  return { error: error as SupabaseError | null };
}

/**
 * Accept a friend request by requester id (receiver only). Fetches the pending request then accepts.
 */
export async function acceptFriendRequestByRequesterId(
  currentUserId: string,
  requesterId: string
): Promise<{ error: SupabaseError | null }> {
  const { data } = await supabase
    .from('friend_requests')
    .select('id')
    .eq('receiver_id', currentUserId)
    .eq('requester_id', requesterId)
    .eq('status', 'pending')
    .maybeSingle();
  const request = data as { id: string } | null;
  if (!request?.id) {
    return { error: { message: 'Request not found or already handled.' } };
  }
  return acceptFriendRequest(request.id);
}

/**
 * Get pending request id from a requester (receiver only). Returns null if none.
 */
export async function getPendingRequestIdFromRequester(
  currentUserId: string,
  requesterId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('friend_requests')
    .select('id')
    .eq('receiver_id', currentUserId)
    .eq('requester_id', requesterId)
    .eq('status', 'pending')
    .maybeSingle();
  const request = data as { id: string } | null;
  return request?.id ?? null;
}

/**
 * Decline a friend request (receiver only). Sets status to 'declined'.
 * After decline, a new request from the same pair is allowed (unique only on pending).
 */
export async function declineFriendRequest(requestId: string): Promise<{ error: SupabaseError | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase inferred never for update
  const { error } = await (supabase.from('friend_requests') as any)
    .update({ status: 'declined' })
    .eq('id', requestId);
  return { error: error as SupabaseError | null };
}

/**
 * List incoming pending requests for the current user (receiver_id = currentUserId).
 */
export async function listIncomingRequests(currentUserId: string): Promise<{
  data: IncomingRequestRow[] | null;
  error: SupabaseError | null;
}> {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('id, requester_id, receiver_id, created_at, requester:profiles!requester_id(username, email, avatar_url)')
    .eq('receiver_id', currentUserId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return { data: (data ?? []) as IncomingRequestRow[], error: error as SupabaseError | null };
}

/**
 * List friends for the current user (from friends table where user_id = currentUserId).
 */
export async function listFriends(currentUserId: string): Promise<{
  data: FriendListItem[] | null;
  error: SupabaseError | null;
}> {
  const { data, error } = await supabase
    .from('friends')
    .select('id, friend_id, created_at, friend:profiles!friend_id(username, email, avatar_url)')
    .eq('user_id', currentUserId)
    .order('created_at', { ascending: false });

  if (error) return { data: null, error: error as SupabaseError };

  const rows = (data ?? []) as FriendRow[];
  const list: FriendListItem[] = rows.map((row) => {
    const friendProfile = Array.isArray(row.friend) ? row.friend[0] : row.friend;
    return {
      id: row.friend_id,
      username: friendProfile?.username ?? null,
      email: friendProfile?.email ?? null,
      avatar_url: friendProfile?.avatar_url ?? null,
    };
  });
  return { data: list, error: null };
}

/**
 * Remove a friendship (both rows). Calls RPC remove_friend.
 * Only valid when relationship is already_friends.
 */
export async function removeFriend(
  currentUserId: string,
  friendId: string
): Promise<{ error: SupabaseError | null }> {
  if (currentUserId === friendId) {
    return { error: { message: 'Cannot remove yourself.' } };
  }
  const state = await getRelationshipState(currentUserId, friendId);
  if (state !== 'already_friends') {
    return { error: { message: 'Not friends with this user.' } };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC args
  const { error } = await (supabase.rpc as any)('remove_friend', { p_friend_id: friendId });
  return { error: error as SupabaseError | null };
}
