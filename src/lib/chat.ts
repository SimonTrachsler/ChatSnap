import { callRpc, getInsertSelectSingleClient, supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { reportError, trackEvent } from '@/lib/telemetry';

type ChatMessageRow = Database['public']['Tables']['chat_messages']['Row'];
type ChatMessageInsert = Database['public']['Tables']['chat_messages']['Insert'];
type ChatThreadRow = Database['public']['Tables']['chat_threads']['Row'];
type LastMessagePreview = Pick<ChatMessageRow, 'body' | 'created_at' | 'message_type' | 'snap_id'>;
type ChatMessageWithSnap = Partial<Pick<ChatMessageRow, 'id' | 'thread_id' | 'sender_id' | 'body' | 'created_at' | 'message_type' | 'snap_id' | 'media_path' | 'metadata' | 'edited_at' | 'deleted_at' | 'scheduled_for'>> & {
  snap?: { opened?: boolean } | { opened?: boolean }[] | null;
};
const chatMessagesInsertClient = getInsertSelectSingleClient<ChatMessageInsert, ChatMessageRow>('chat_messages');

export type ChatMessage = Pick<ChatMessageRow, 'id' | 'thread_id' | 'sender_id' | 'body' | 'created_at' | 'message_type' | 'snap_id' | 'media_path' | 'metadata' | 'edited_at' | 'deleted_at' | 'scheduled_for'> & {
  /** Derived from snaps.opened for message_type === 'snap' */
  snapOpened?: boolean;
};

const DEFAULT_LIMIT = 100;

type ChatLikeError = {
  message?: string;
  code?: string;
};

const CHAT_MESSAGE_SELECT_EXTENDED =
  'id, thread_id, sender_id, body, created_at, message_type, snap_id, media_path, metadata, edited_at, deleted_at, scheduled_for';
const CHAT_MESSAGE_SELECT_LEGACY =
  'id, thread_id, sender_id, body, created_at, message_type, snap_id';
const CHAT_MESSAGE_LIST_EXTENDED = `${CHAT_MESSAGE_SELECT_EXTENDED}, snap:snaps!snap_id(opened)`;
const CHAT_MESSAGE_LIST_LEGACY = `${CHAT_MESSAGE_SELECT_LEGACY}, snap:snaps!snap_id(opened)`;

function isMissingChatColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as ChatLikeError;
  const code = e.code ?? '';
  const message = (e.message ?? '').toLowerCase();
  if (code !== '42703') return false;
  return message.includes('chat_messages.deleted_at')
    || message.includes('chat_messages.media_path')
    || message.includes('chat_messages.metadata')
    || message.includes('chat_messages.edited_at')
    || message.includes('chat_messages.scheduled_for');
}

function mapChatMessageRow(row: ChatMessageWithSnap): ChatMessage {
  const snap = row.snap;
  let snapOpened: boolean | undefined;
  if (Array.isArray(snap)) snapOpened = !!snap[0]?.opened;
  else if (snap) snapOpened = !!snap.opened;
  return {
    id: row.id ?? '',
    thread_id: row.thread_id ?? '',
    sender_id: row.sender_id ?? '',
    body: row.body ?? '',
    created_at: row.created_at ?? new Date().toISOString(),
    message_type: row.message_type ?? 'text',
    snap_id: row.snap_id ?? null,
    media_path: row.media_path ?? null,
    metadata: row.metadata ?? {},
    edited_at: row.edited_at ?? null,
    deleted_at: row.deleted_at ?? null,
    scheduled_for: row.scheduled_for ?? null,
    snapOpened,
  };
}

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
  const runQuery = (selectClause: string) => {
    let q = supabase
      .from('chat_messages')
      .select(selectClause)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (before) q = q.lt('created_at', before);
    return q;
  };

  let res = await runQuery(CHAT_MESSAGE_LIST_EXTENDED);
  if (res.error && isMissingChatColumnError(res.error)) {
    res = await runQuery(CHAT_MESSAGE_LIST_LEGACY);
  }
  if (res.error) throw res.error;

  const rows = ((res.data ?? []) as ChatMessageWithSnap[]).filter(
    (row): row is ChatMessageWithSnap => Boolean(row && typeof row === 'object' && row.id),
  );
  return rows.map(mapChatMessageRow);
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
    .select(CHAT_MESSAGE_SELECT_LEGACY)
    .single();
  if (error) {
    console.error('[chat] sendMessage error:', { message: error.message, code: error.code });
    void reportError('chat_send_message_insert_failed', error, {
      threadId,
      bodyLength: body.length,
    });
    throw error;
  }
  invalidateThreadsCache();
  void trackEvent('chat_message_inserted', {
    threadId,
    bodyLength: body.length,
  });
  return mapChatMessageRow(data as ChatMessageWithSnap);
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
    .select(CHAT_MESSAGE_SELECT_LEGACY)
    .single();
  if (error) {
    console.error('[chat] sendSnapMessage error:', { message: error.message, code: error.code });
    void reportError('chat_send_snap_message_failed', error, {
      threadId,
      snapId,
    });
    throw error;
  }
  invalidateThreadsCache();
  void trackEvent('chat_snap_message_inserted', {
    threadId,
    snapId,
  });
  return mapChatMessageRow(data as ChatMessageWithSnap);
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

  type RpcRow = {
    thread_id: string;
    other_user_id: string;
    other_username: string | null;
    other_avatar_url: string | null;
    preview_text: string;
    last_at: string;
    last_type: string;
    last_snap_opened: boolean | null;
    has_unread: boolean;
  };

  const { data: rpcRows, error: rpcError } = await callRpc<RpcRow[]>('list_threads_with_preview', {
    p_limit: 50,
  });
  if (!rpcError && Array.isArray(rpcRows)) {
    const mapped = rpcRows.map((row) => ({
      threadId: row.thread_id,
      otherUserId: row.other_user_id,
      otherUsername: row.other_username,
      otherAvatarUrl: row.other_avatar_url,
      previewText: row.preview_text ?? '',
      lastAt: row.last_at,
      lastType: row.last_type === 'snap' ? 'snap' : 'text',
      lastSnapOpened: row.last_snap_opened ?? undefined,
      hasUnread: !!row.has_unread,
    } satisfies ThreadWithPreview));
    _threadsCache = { userId: myUserId, data: mapped, ts: Date.now() };
    return mapped;
  }

  const { data: threads, error: threadsError } = await supabase
    .from('chat_threads')
    .select('id, user_a, user_b, created_at')
    .or(`user_a.eq.${myUserId},user_b.eq.${myUserId}`)
    .limit(50);
  if (threadsError) throw threadsError;
  if (!threads?.length) return [];

  const threadRows: ChatThreadRow[] = threads;

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

  const results = await Promise.all(
    threadRows.map(async (t) => {
      const otherId = t.user_a === myUserId ? t.user_b : t.user_a;

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
