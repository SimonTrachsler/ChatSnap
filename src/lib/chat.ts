import { callRpc, getInsertSelectSingleClient, supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type ChatMessageRow = Database['public']['Tables']['chat_messages']['Row'];
type ChatMessageInsert = Database['public']['Tables']['chat_messages']['Insert'];
type ChatThreadRow = Database['public']['Tables']['chat_threads']['Row'];
type LastMessagePreview = Pick<ChatMessageRow, 'body' | 'created_at' | 'message_type' | 'snap_id'>;
type ChatMessageWithSnap = Pick<ChatMessageRow, 'id' | 'thread_id' | 'sender_id' | 'body' | 'created_at' | 'message_type' | 'snap_id'> & {
  snap?: { opened?: boolean } | { opened?: boolean }[] | null;
};
const chatMessagesInsertClient = getInsertSelectSingleClient<ChatMessageInsert, ChatMessageRow>('chat_messages');

export type ChatMessage = Pick<ChatMessageRow, 'id' | 'thread_id' | 'sender_id' | 'body' | 'created_at' | 'message_type' | 'snap_id'> & {
  /** Derived from snaps.opened for message_type === 'snap' */
  snapOpened?: boolean;
};

const DEFAULT_LIMIT = 100;

type ChatLikeError = {
  message?: string;
  code?: string;
};

export function isOnlyFriendsChatError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as ChatLikeError;
  const code = e.code ?? '';
  const message = (e.message ?? '').toLowerCase();
  return code === 'P0001' && message.includes('only friends can open a chat');
}

export async function canOpenChatWithUser(myUserId: string, otherUserId: string): Promise<boolean> {
  if (!myUserId || !otherUserId || myUserId === otherUserId) return false;
  const { data, error } = await supabase
    .from('friends')
    .select('id')
    .eq('user_id', myUserId)
    .eq('friend_id', otherUserId)
    .maybeSingle();
  if (error) throw error;
  return Boolean((data as { id?: string } | null)?.id);
}

/**
 * Get or create a 1:1 chat thread with another user. Only works if both users are friends.
 * @returns thread_id
 */
export async function getOrCreateThread(otherUserId: string): Promise<string> {
  const { data, error } = await callRpc<string>('get_or_create_thread', {
    other_user_id: otherUserId,
  });
  if (error) {
    if (!isOnlyFriendsChatError(error)) {
      console.error('[chat] getOrCreateThread error:', { message: error.message, code: error.code });
    }
    throw error;
  }
  if (data == null) {
    console.error('[chat] get_or_create_thread returned no thread_id');
    throw new Error('get_or_create_thread returned no thread_id');
  }
  return data;
}

/**
 * List messages in a thread, ordered by created_at ascending.
 * @param before - optional cursor (created_at) for pagination
 */
export async function listMessages(
  threadId: string,
  limit: number = DEFAULT_LIMIT,
  before?: string
): Promise<ChatMessage[]> {
  let q = supabase
    .from('chat_messages')
    .select('id, thread_id, sender_id, body, created_at, message_type, snap_id, snap:snaps!snap_id(opened)')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (before) {
    q = q.lt('created_at', before);
  }
  const { data, error } = await q;
  if (error) throw error;
  const rows: ChatMessageWithSnap[] = ((data ?? []) as ChatMessageWithSnap[]).filter(
    (row): row is ChatMessageWithSnap => Boolean(row && typeof row === 'object' && row.id),
  );
  return rows.map((row) => {
    const { snap } = row;
    let snapOpened: boolean | undefined;
    if (Array.isArray(snap)) {
      snapOpened = !!snap[0]?.opened;
    } else if (snap) {
      snapOpened = !!snap.opened;
    }
    return {
      id: row.id,
      thread_id: row.thread_id,
      sender_id: row.sender_id,
      body: row.body,
      created_at: row.created_at,
      message_type: row.message_type,
      snap_id: row.snap_id,
      snapOpened,
    };
  });
}

/**
 * Send a text message in a thread. sender_id is set server-side via auth.uid() in RLS;
 * we pass thread_id and body only (sender comes from session).
 */
export async function sendMessage(
  threadId: string,
  body: string
): Promise<ChatMessage> {
  const res = await supabase.auth.getUser();
  const senderId = res.data.user?.id;
  if (!senderId) throw new Error('Not authenticated');

  const messageInsert: ChatMessageInsert = {
    thread_id: threadId,
    sender_id: senderId,
    body: body.trim(),
    message_type: 'text',
  };
  const { data, error } = await chatMessagesInsertClient
    .insert(messageInsert)
    .select('id, thread_id, sender_id, body, created_at, message_type, snap_id')
    .single();
  if (error) {
    console.error('[chat] sendMessage error:', { message: error.message, code: error.code });
    throw error;
  }
  invalidateThreadsCache();
  return data as ChatMessage;
}

/**
 * Subscribe to new messages in a thread (Realtime INSERT on chat_messages).
 * @returns unsubscribe function
 */
export function subscribeToMessages(
  threadId: string,
  onInsert: (message: ChatMessage) => void
): () => void {
  const channel = supabase
    .channel(`chat_messages:${threadId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `thread_id=eq.${threadId}`,
      },
      (payload) => {
        const row = payload.new as ChatMessage;
        onInsert(row);
      }
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Marks all unread messages from the other person in a thread as read.
 */
export async function markThreadRead(threadId: string): Promise<void> {
  const { error } = await callRpc<void>('mark_thread_read', { p_thread_id: threadId });
  if (error) {
    console.error('[chat] markThreadRead error:', error.message);
    throw error;
  }
  invalidateThreadsCache();
}

/**
 * Returns the total message count in the shared thread with another user.
 */
export async function getMessageCount(otherUserId: string): Promise<number> {
  const threadId = await getOrCreateThread(otherUserId);
  const { count, error } = await supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', threadId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Insert a snap-type message into a chat thread.
 */
export async function sendSnapMessage(
  threadId: string,
  snapId: string,
): Promise<ChatMessage> {
  const res = await supabase.auth.getUser();
  const senderId = res.data.user?.id;
  if (!senderId) throw new Error('Not authenticated');

  const messageInsert: ChatMessageInsert = {
    thread_id: threadId,
    sender_id: senderId,
    body: '',
    message_type: 'snap',
    snap_id: snapId,
  };
  const { data, error } = await chatMessagesInsertClient
    .insert(messageInsert)
    .select('id, thread_id, sender_id, body, created_at, message_type, snap_id')
    .single();
  if (error) {
    console.error('[chat] sendSnapMessage error:', { message: error.message, code: error.code });
    throw error;
  }
  invalidateThreadsCache();
  return data as ChatMessage;
}

export type ThreadWithPreview = {
  threadId: string;
  otherUserId: string;
  otherUsername: string | null;
  otherAvatarUrl: string | null;
  /** Human‑readable preview text representing latest activity (text or snap). */
  previewText: string;
  /** ISO timestamp of the last message in the thread. */
  lastAt: string;
  /** 'text' or 'snap' depending on latest message type. */
  lastType: 'text' | 'snap';
  /** Only relevant when lastType === 'snap'. */
  lastSnapOpened?: boolean;
  /** True if there are unread messages (of any type) from the other user. */
  hasUnread: boolean;
};

const THREADS_CACHE_TTL_MS = 5_000;
let _threadsCache: { userId: string; data: ThreadWithPreview[]; ts: number } | null = null;

/**
 * List threads the current user participates in, with last message preview.
 * Parallelized: per-thread queries run concurrently. Profiles are batch-fetched.
 * Results are cached for 5 s to avoid duplicate calls across tabs.
 */
export async function listThreadsWithPreview(
  myUserId: string
): Promise<ThreadWithPreview[]> {
  if (
    _threadsCache &&
    _threadsCache.userId === myUserId &&
    Date.now() - _threadsCache.ts < THREADS_CACHE_TTL_MS
  ) {
    return _threadsCache.data;
  }

  const { data: threads, error: threadsError } = await supabase
    .from('chat_threads')
    .select('id, user_a, user_b, created_at')
    .or(`user_a.eq.${myUserId},user_b.eq.${myUserId}`)
    .limit(50);
  if (threadsError) throw threadsError;
  if (!threads?.length) return [];

  const threadRows: ChatThreadRow[] = threads;

  // Batch-fetch all other-user profiles in one query
  const otherIds = threadRows.map((t) => (t.user_a === myUserId ? t.user_b : t.user_a));
  const uniqueOtherIds = [...new Set(otherIds)];
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', uniqueOtherIds);
  const profileMap = new Map<string, { username: string | null; avatar_url: string | null }>();
  for (const p of (profileRows ?? []) as { id: string; username?: string | null; avatar_url?: string | null }[]) {
    profileMap.set(p.id, { username: p.username ?? null, avatar_url: p.avatar_url ?? null });
  }

  // Process all threads in parallel
  const results = await Promise.all(
    threadRows.map(async (t) => {
      const otherId = t.user_a === myUserId ? t.user_b : t.user_a;

      // Run last-message and unread-count queries in parallel
      const [lastMsgRes, unreadRes] = await Promise.all([
        supabase
          .from('chat_messages')
          .select('body, created_at, message_type, snap_id')
          .eq('thread_id', t.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('thread_id', t.id)
          .is('read_at', null)
          .neq('sender_id', myUserId),
      ]);

      const lastMessage = lastMsgRes.data as LastMessagePreview | null;

      let previewText = '';
      let lastType: 'text' | 'snap' = 'text';
      let lastSnapOpened: boolean | undefined;
      const lastAt = lastMessage?.created_at ?? t.created_at;

      if (lastMessage) {
        const msgType = lastMessage.message_type ?? 'text';
        if (msgType === 'snap' && lastMessage.snap_id) {
          lastType = 'snap';
          const { data: snapRow } = await supabase
            .from('snaps')
            .select('opened')
            .eq('id', lastMessage.snap_id)
            .maybeSingle();
          const opened = (snapRow as Pick<Database['public']['Tables']['snaps']['Row'], 'opened'> | null)?.opened ?? false;
          lastSnapOpened = opened;
          previewText = opened ? 'opened' : 'Snap to open';
        } else {
          lastType = 'text';
          previewText = (lastMessage.body ?? '').trim();
        }
      }

      const prof = profileMap.get(otherId);
      return {
        threadId: t.id,
        otherUserId: otherId,
        otherUsername: prof?.username ?? null,
        otherAvatarUrl: prof?.avatar_url ?? null,
        previewText: previewText || '',
        lastAt,
        lastType,
        lastSnapOpened,
        hasUnread: typeof unreadRes.count === 'number' ? unreadRes.count > 0 : false,
      } as ThreadWithPreview;
    }),
  );

  results.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  _threadsCache = { userId: myUserId, data: results, ts: Date.now() };
  return results;
}

/** Invalidate the threads preview cache (call after sending a message, etc.) */
export function invalidateThreadsCache(): void {
  _threadsCache = null;
}
