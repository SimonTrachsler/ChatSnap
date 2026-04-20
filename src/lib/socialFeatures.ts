/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/lib/supabase';
import { uploadToBucketWithRetry, uriToBase64 } from '@/lib/uploadHelper';

type ChatMessageType = 'text' | 'snap' | 'image' | 'voice' | 'video';

export type MessageReactionSummary = {
  messageId: string;
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

export type StoryItem = {
  id: string;
  user_id: string;
  media_path: string;
  media_kind: 'image' | 'video';
  caption: string | null;
  is_sensitive: boolean;
  created_at: string;
  expires_at: string;
  profile_username?: string | null;
  profile_avatar_url?: string | null;
  viewed_by_me?: boolean;
};

export type GroupThreadItem = {
  id: string;
  title: string;
  owner_id: string;
  avatar_url: string | null;
  created_at: string;
};

export type GroupThreadWithPreview = GroupThreadItem & {
  member_count: number;
  last_message_body: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
};

export type GroupThreadMemberItem = {
  id: string;
  thread_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  username: string | null;
  avatar_url: string | null;
};

export type GroupMessageItem = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  message_type: string;
  media_path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  sender_username: string | null;
  sender_avatar_url: string | null;
};

type BackendErrorLike = {
  message?: string;
  code?: string;
};

const GROUP_THREADS_CACHE_TTL_MS = 5_000;
let groupThreadsCache: { userId: string; data: GroupThreadItem[]; ts: number } | null = null;
let groupThreadPreviewsCache: { userId: string; data: GroupThreadWithPreview[]; ts: number } | null = null;
const STORIES_CACHE_TTL_MS = 8_000;
let friendStoriesCache: { viewerId: string | null; data: StoryItem[]; ts: number } | null = null;
const storiesByUserCache = new Map<string, { viewerId: string | null; data: StoryItem[]; ts: number }>();
const storySignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function guessExtension(uri: string, fallback: string): string {
  const parts = uri.split('?')[0].split('#')[0].split('.');
  const ext = parts.length > 1 ? parts[parts.length - 1]?.toLowerCase() : '';
  if (!ext || ext.length > 6) return fallback;
  return ext;
}

function guessMimeByType(kind: 'voice' | 'video', ext: string): string {
  const lower = ext.toLowerCase();
  if (kind === 'video') {
    if (lower === 'mov') return 'video/quicktime';
    if (lower === 'webm') return 'video/webm';
    return 'video/mp4';
  }
  if (lower === 'wav') return 'audio/wav';
  if (lower === 'm4a') return 'audio/x-m4a';
  if (lower === 'aac') return 'audio/aac';
  return 'audio/mpeg';
}

function guessImageMime(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === 'png') return 'image/png';
  if (lower === 'webp') return 'image/webp';
  if (lower === 'heic') return 'image/heic';
  if (lower === 'heif') return 'image/heif';
  return 'image/jpeg';
}

function base64ToUint8Array(b64: string): Uint8Array {
  const raw = b64.replace(/^data:[^;]+;base64,/, '').trim();
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isMissingBackendResourceError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as BackendErrorLike;
  const code = (e.code ?? '').toLowerCase();
  const message = (e.message ?? '').toLowerCase();
  return (
    code === '42p01' ||
    code === '42703' ||
    code === '42883' ||
    code === 'pgrst205' ||
    message.includes('does not exist') ||
    message.includes('could not find the table')
  );
}

function isBucketNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = ((error as BackendErrorLike).message ?? '').toLowerCase();
  return message.includes('bucket not found');
}

function isDirectMediaUrl(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('file://')
  );
}

function decodeRepeatedly(value: string, maxRounds = 3): string {
  let current = value;
  for (let i = 0; i < maxRounds; i += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

function normalizeStoryPath(path: string): string {
  let value = path.trim();
  if (!value) return value;

  value = decodeRepeatedly(value, 3);
  value = value.replace(/^\/+/, '');
  value = value.replace(/^public\/stories-media\//i, '');
  value = value.replace(/^stories-media\//i, '');
  value = value.replace(/%2f/gi, '/');
  value = value.replace(/^\/+/, '');
  return value;
}

function extractStoryPathFromSupabaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const pathname = decodeRepeatedly(url.pathname, 3);
    const patterns = [
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/stories-media(?:\/|%2f)(.+)$/i,
      /\/storage\/v1\/object\/stories-media(?:\/|%2f)(.+)$/i,
    ];
    for (const pattern of patterns) {
      const match = pathname.match(pattern);
      if (!match?.[1]) continue;
      const normalized = normalizeStoryPath(match[1]);
      if (normalized) return normalized;
    }
  } catch {
    return null;
  }
  return null;
}

function storyPathCandidates(path: string): string[] {
  const normalized = normalizeStoryPath(path);
  if (!normalized) return [];

  const candidates = new Set<string>();
  candidates.add(normalized);

  const prefixA = 'stories-media/';
  if (normalized.startsWith(prefixA)) {
    candidates.add(normalized.slice(prefixA.length));
  }

  const prefixB = 'public/stories-media/';
  if (normalized.startsWith(prefixB)) {
    candidates.add(normalized.slice(prefixB.length));
  }

  const firstSlash = normalized.indexOf('/');
  if (firstSlash > 0 && firstSlash + 1 < normalized.length) {
    candidates.add(normalized.slice(firstSlash + 1));
  }

  return Array.from(candidates).filter((candidate) => !!candidate);
}

function invalidateStoriesCaches(): void {
  friendStoriesCache = null;
  storiesByUserCache.clear();
}

function readStorySignedUrlCache(path: string): string | null {
  const cached = storySignedUrlCache.get(path);
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt) {
    storySignedUrlCache.delete(path);
    return null;
  }
  return cached.url;
}

function writeStorySignedUrlCache(path: string, url: string, expirySeconds: number): void {
  const ttl = Math.max(30_000, expirySeconds * 1000 - 20_000);
  storySignedUrlCache.set(path, {
    url,
    expiresAt: Date.now() + ttl,
  });
}

function isUuidLike(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function extractGroupThreadId(value: unknown): string | null {
  if (isUuidLike(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractGroupThreadId(item);
      if (extracted) return extracted;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const candidates = [obj.id, obj.thread_id, obj.create_group_thread, obj.create_group_thread_v2];
  for (const candidate of candidates) {
    const extracted = extractGroupThreadId(candidate);
    if (extracted) return extracted;
  }
  return null;
}

export async function uploadChatImageFromUri(
  userId: string,
  uri: string,
): Promise<{ path: string; mimeType: string }> {
  const ext = guessExtension(uri, 'jpg');
  const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
  const mimeType = guessImageMime(normalizedExt);
  const path = `${userId}/image-${uniqueSuffix()}.${normalizedExt}`;
  const base64 = await uriToBase64(uri);
  const bytes = base64ToUint8Array(base64);
  if (!bytes.byteLength) throw new Error('Image file is empty.');
  try {
    await uploadToBucketWithRetry('chat-media', path, bytes, {
      contentType: mimeType,
      upsert: false,
    });
  } catch (error) {
    if (isBucketNotFoundError(error)) {
      throw new Error('Chat media storage is not configured on backend yet.');
    }
    throw error;
  }
  return { path, mimeType };
}

export async function getChatMediaSignedUrl(mediaPath: string, expirySeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(mediaPath, expirySeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function sendRichChatMessage(
  threadId: string,
  payload: {
    body: string;
    messageType?: ChatMessageType;
    mediaPath?: string | null;
    metadata?: Record<string, unknown>;
    scheduledFor?: string | null;
  },
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const senderId = data.user?.id;
  if (!senderId) throw new Error('Not authenticated');

  const insertPayload = {
    thread_id: threadId,
    sender_id: senderId,
    body: payload.body,
    message_type: payload.messageType ?? 'text',
    media_path: payload.mediaPath ?? null,
    metadata: payload.metadata ?? {},
    scheduled_for: payload.scheduledFor ?? null,
  };

  const { error } = await (supabase.from('chat_messages') as any).insert(insertPayload);
  if (error && isMissingBackendResourceError(error)) {
    const { error: fallbackError } = await (supabase.from('chat_messages') as any).insert({
      thread_id: threadId,
      sender_id: senderId,
      body: payload.body,
      message_type: payload.messageType ?? 'text',
    });
    if (fallbackError) throw fallbackError;
    return;
  }
  if (error) throw error;
}

export async function scheduleChatMessage(
  threadId: string,
  payload: {
    body: string;
    messageType?: ChatMessageType;
    mediaPath?: string | null;
    metadata?: Record<string, unknown>;
    scheduledFor: string;
  },
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const senderId = data.user?.id;
  if (!senderId) throw new Error('Not authenticated');

  const { error } = await (supabase.from('scheduled_chat_messages') as any).insert({
    thread_id: threadId,
    sender_id: senderId,
    body: payload.body,
    message_type: payload.messageType ?? 'text',
    media_path: payload.mediaPath ?? null,
    metadata: payload.metadata ?? {},
    scheduled_for: payload.scheduledFor,
  });
  if (error && isMissingBackendResourceError(error)) {
    throw new Error('Scheduled messages are not enabled on backend yet. Run latest Supabase migrations first.');
  }
  if (error) throw error;
}

export async function dispatchDueScheduledMessages(): Promise<number> {
  const { data, error } = await (supabase.rpc as any)('dispatch_due_scheduled_messages');
  if (error && isMissingBackendResourceError(error)) return 0;
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function toggleMessageReaction(messageId: string, emoji: string): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)('toggle_chat_message_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error && isMissingBackendResourceError(error)) return false;
  if (error) throw error;
  return !!data;
}

export async function listMessageReactions(
  messageIds: string[],
): Promise<{ byMessage: Record<string, MessageReactionSummary[]> }> {
  if (!messageIds.length) return { byMessage: {} };
  const { data: authData } = await supabase.auth.getUser();
  const myId = authData.user?.id ?? null;

  const { data, error } = await (supabase.from('chat_message_reactions') as any)
    .select('message_id, emoji, user_id')
    .in('message_id', messageIds);
  if (error && isMissingBackendResourceError(error)) return { byMessage: {} };
  if (error) throw error;

  type RawRow = { message_id: string; emoji: string; user_id: string };
  const rows = (data ?? []) as RawRow[];
  const map = new Map<string, Map<string, { count: number; reactedByMe: boolean }>>();

  for (const row of rows) {
    const inner = map.get(row.message_id) ?? new Map<string, { count: number; reactedByMe: boolean }>();
    const prev = inner.get(row.emoji) ?? { count: 0, reactedByMe: false };
    prev.count += 1;
    if (myId && row.user_id === myId) prev.reactedByMe = true;
    inner.set(row.emoji, prev);
    map.set(row.message_id, inner);
  }

  const byMessage: Record<string, MessageReactionSummary[]> = {};
  for (const [messageId, emojiMap] of map.entries()) {
    byMessage[messageId] = Array.from(emojiMap.entries()).map(([emoji, stats]) => ({
      messageId,
      emoji,
      count: stats.count,
      reactedByMe: stats.reactedByMe,
    }));
  }

  return { byMessage };
}

export async function updateOwnChatMessage(messageId: string, nextBody: string): Promise<void> {
  const { error } = await (supabase.from('chat_messages') as any)
    .update({ body: nextBody })
    .eq('id', messageId);
  if (error && isMissingBackendResourceError(error)) return;
  if (error) throw error;
}

export async function deleteOwnChatMessage(messageId: string): Promise<void> {
  const { error } = await (supabase.from('chat_messages') as any)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error && isMissingBackendResourceError(error)) {
    const { error: fallbackError } = await (supabase.from('chat_messages') as any).delete().eq('id', messageId);
    if (fallbackError) throw fallbackError;
    return;
  }
  if (error) throw error;
}

export async function createStoryFromUri(
  userId: string,
  uri: string,
  mediaKind: 'image' | 'video',
  options?: { caption?: string; isSensitive?: boolean },
): Promise<void> {
  const ext = guessExtension(uri, mediaKind === 'video' ? 'mp4' : 'jpg');
  const path = `${userId}/${mediaKind}-${uniqueSuffix()}.${ext}`;
  const mimeType =
    mediaKind === 'video'
      ? guessMimeByType('video', ext)
      : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
  let payload: Uint8Array | Blob;
  if (mediaKind === 'image') {
    const base64 = await uriToBase64(uri);
    payload = base64ToUint8Array(base64);
    if (!payload.byteLength) throw new Error('Story image file is empty.');
  } else {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Failed to read story media (${response.status})`);
    const blob = await response.blob();
    payload = blob;
  }

  try {
    await uploadToBucketWithRetry('stories-media', path, payload, {
      contentType: mimeType,
      upsert: false,
    });
  } catch (error) {
    if (isBucketNotFoundError(error)) {
      throw new Error('Stories are not enabled on backend yet. Run latest Supabase migrations first.');
    }
    throw error;
  }

  const { error } = await (supabase.from('stories') as any).insert({
    user_id: userId,
    media_path: path,
    media_kind: mediaKind,
    caption: options?.caption ?? null,
    is_sensitive: options?.isSensitive ?? false,
  });
  if (error && isMissingBackendResourceError(error)) {
    throw new Error('Stories are not enabled on backend yet. Run latest Supabase migrations first.');
  }
  if (error) throw error;
  invalidateStoriesCaches();
}

export async function listFriendStories(): Promise<StoryItem[]> {
  const nowIso = new Date().toISOString();
  const { data: authData } = await supabase.auth.getUser();
  const myId = authData.user?.id ?? null;

  if (
    friendStoriesCache &&
    friendStoriesCache.viewerId === myId &&
    Date.now() - friendStoriesCache.ts < STORIES_CACHE_TTL_MS
  ) {
    return friendStoriesCache.data;
  }

  const { data, error } = await (supabase.from('stories') as any)
    .select('id, user_id, media_path, media_kind, caption, is_sensitive, created_at, expires_at, profile:profiles!user_id(username, avatar_url)')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });
  if (error && isMissingBackendResourceError(error)) return [];
  if (error) throw error;

  const storyRows = (data ?? []) as Array<{
    id: string;
    user_id: string;
    media_path: string;
    media_kind: 'image' | 'video';
    caption: string | null;
    is_sensitive: boolean;
    created_at: string;
    expires_at: string;
    profile?: { username?: string | null; avatar_url?: string | null } | { username?: string | null; avatar_url?: string | null }[] | null;
  }>;

  const storyIds = storyRows.map((row) => row.id);
  let viewedIds = new Set<string>();
  if (storyIds.length && myId) {
    const { data: views } = await (supabase.from('story_views') as any)
      .select('story_id')
      .in('story_id', storyIds)
      .eq('viewer_id', myId);
    viewedIds = new Set(((views ?? []) as Array<{ story_id: string }>).map((v) => v.story_id));
  }

  const mapped = storyRows.map((row) => {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    return {
      ...row,
      media_path: normalizeStoryPath(row.media_path),
      profile_username: profile?.username ?? null,
      profile_avatar_url: profile?.avatar_url ?? null,
      viewed_by_me: viewedIds.has(row.id),
    };
  });
  friendStoriesCache = {
    viewerId: myId,
    data: mapped,
    ts: Date.now(),
  };
  return mapped;
}

export async function resolveStoryOwnerId(storyId: string): Promise<string | null> {
  const { data, error } = await (supabase.from('stories') as any)
    .select('user_id')
    .eq('id', storyId)
    .maybeSingle();
  if (error && isMissingBackendResourceError(error)) return null;
  if (error) throw error;
  const row = data as { user_id?: string } | null;
  return typeof row?.user_id === 'string' ? row.user_id : null;
}

export async function listStoriesByUser(userId: string): Promise<StoryItem[]> {
  const nowIso = new Date().toISOString();
  const { data: authData } = await supabase.auth.getUser();
  const myId = authData.user?.id ?? null;
  const cacheKey = `${myId ?? 'anon'}:${userId}`;
  const cached = storiesByUserCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STORIES_CACHE_TTL_MS) {
    return cached.data;
  }

  const { data, error } = await (supabase.from('stories') as any)
    .select('id, user_id, media_path, media_kind, caption, is_sensitive, created_at, expires_at, profile:profiles!user_id(username, avatar_url)')
    .eq('user_id', userId)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: true });
  if (error && isMissingBackendResourceError(error)) return [];
  if (error) throw error;

  const storyRows = (data ?? []) as Array<{
    id: string;
    user_id: string;
    media_path: string;
    media_kind: 'image' | 'video';
    caption: string | null;
    is_sensitive: boolean;
    created_at: string;
    expires_at: string;
    profile?: { username?: string | null; avatar_url?: string | null } | { username?: string | null; avatar_url?: string | null }[] | null;
  }>;

  const storyIds = storyRows.map((row) => row.id);
  let viewedIds = new Set<string>();
  if (storyIds.length && myId) {
    const { data: views } = await (supabase.from('story_views') as any)
      .select('story_id')
      .in('story_id', storyIds)
      .eq('viewer_id', myId);
    viewedIds = new Set(((views ?? []) as Array<{ story_id: string }>).map((v) => v.story_id));
  }

  const mapped = storyRows.map((row) => {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    return {
      ...row,
      media_path: normalizeStoryPath(row.media_path),
      profile_username: profile?.username ?? null,
      profile_avatar_url: profile?.avatar_url ?? null,
      viewed_by_me: viewedIds.has(row.id),
    };
  });
  storiesByUserCache.set(cacheKey, {
    viewerId: myId,
    data: mapped,
    ts: Date.now(),
  });
  return mapped;
}

export async function markStoryViewed(storyId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)('mark_story_viewed', { p_story_id: storyId });
  if (error && isMissingBackendResourceError(error)) return;
  if (error) throw error;
  invalidateStoriesCaches();
}

export async function getStorySignedUrl(path: string, expirySeconds = 3600): Promise<string | null> {
  const rawPath = path?.trim();
  if (!rawPath) return null;
  if (rawPath.startsWith('data:') || rawPath.startsWith('file://')) return rawPath;

  let candidates: string[] = [];
  let fallbackDirectUrl: string | null = null;

  if (isDirectMediaUrl(rawPath)) {
    const extractedPath = extractStoryPathFromSupabaseUrl(rawPath);
    if (extractedPath) {
      candidates = storyPathCandidates(extractedPath);
    } else {
      const lower = rawPath.toLowerCase();
      const isSupabaseStorageUrl = lower.includes('/storage/v1/object/');
      fallbackDirectUrl = isSupabaseStorageUrl ? null : rawPath;
    }
  } else {
    candidates = storyPathCandidates(rawPath);
  }

  for (const candidate of candidates) {
    const cached = readStorySignedUrlCache(candidate);
    if (cached) return cached;

    const { data, error } = await supabase.storage.from('stories-media').createSignedUrl(candidate, expirySeconds);
    if (error && isBucketNotFoundError(error)) return null;
    if (!error && data?.signedUrl) {
      writeStorySignedUrlCache(candidate, data.signedUrl, expirySeconds);
      return data.signedUrl;
    }
  }

  if (fallbackDirectUrl) return fallbackDirectUrl;
  return null;
}

export async function listBestFriendIds(ownerId: string): Promise<string[]> {
  const { data, error } = await (supabase.from('best_friends') as any)
    .select('friend_id')
    .eq('owner_id', ownerId)
    .order('rank', { ascending: false })
    .order('created_at', { ascending: false });
  if (error && isMissingBackendResourceError(error)) return [];
  if (error) throw error;
  return ((data ?? []) as Array<{ friend_id: string }>).map((row) => row.friend_id);
}

export async function setBestFriend(ownerId: string, friendId: string, enabled: boolean): Promise<void> {
  if (!enabled) {
    const { error } = await (supabase.from('best_friends') as any)
      .delete()
      .eq('owner_id', ownerId)
      .eq('friend_id', friendId);
    if (error && isMissingBackendResourceError(error)) return;
    if (error) throw error;
    return;
  }

  const existingIds = await listBestFriendIds(ownerId);
  const alreadyBestFriend = existingIds.includes(friendId);
  if (!alreadyBestFriend && existingIds.length >= 3) {
    throw new Error('You can only pin up to 3 favorite chats.');
  }

  const { error } = await (supabase.from('best_friends') as any).upsert({
    owner_id: ownerId,
    friend_id: friendId,
    rank: 100,
  }, { onConflict: 'owner_id,friend_id' });
  if (error && isMissingBackendResourceError(error)) return;
  if (error) throw error;
}

export async function createGroupThread(
  title: string,
  memberIds: string[],
  avatarUrl?: string | null,
): Promise<string> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('Group name is required.');

  const normalizedAvatar = avatarUrl?.trim() ? avatarUrl.trim() : null;
  const uniqueMemberIds = Array.from(new Set(memberIds.filter((id) => !!id)));

  const { data, error } = await (supabase.rpc as any)('create_group_thread_v2', {
    p_title: normalizedTitle,
    p_member_ids: uniqueMemberIds,
    p_avatar_url: normalizedAvatar,
  });

  if (error && isMissingBackendResourceError(error)) {
    const { data: legacyData, error: legacyError } = await (supabase.rpc as any)('create_group_thread', {
      p_title: normalizedTitle,
      p_member_ids: uniqueMemberIds,
    });
    if (legacyError && isMissingBackendResourceError(legacyError)) {
      throw new Error('Group chats are not enabled on backend yet.');
    }
    if (legacyError) throw legacyError;
    const legacyGroupId = extractGroupThreadId(legacyData);
    if (!legacyGroupId) throw new Error('No group id returned');
    invalidateGroupThreadCaches();
    return legacyGroupId;
  }

  if (error) throw error;
  const groupId = extractGroupThreadId(data);
  if (!groupId) throw new Error('No group id returned');
  invalidateGroupThreadCaches();
  return groupId;
}

export async function getGroupThreadById(threadId: string): Promise<GroupThreadItem | null> {
  const { data, error } = await (supabase.from('group_threads') as any)
    .select('id, title, owner_id, avatar_url, created_at')
    .eq('id', threadId)
    .maybeSingle();
  if (error && isMissingBackendResourceError(error)) return null;
  if (error) throw error;
  return (data ?? null) as GroupThreadItem | null;
}

export async function listMyGroupThreads(): Promise<GroupThreadItem[]> {
  const { data: authData } = await supabase.auth.getUser();
  const myId = authData.user?.id;
  if (!myId) return [];

  if (
    groupThreadsCache &&
    groupThreadsCache.userId === myId &&
    Date.now() - groupThreadsCache.ts < GROUP_THREADS_CACHE_TTL_MS
  ) {
    return groupThreadsCache.data;
  }

  const { data, error } = await (supabase.from('group_thread_members') as any)
    .select('thread:group_threads(id, title, owner_id, avatar_url, created_at)')
    .eq('user_id', myId)
    .order('joined_at', { ascending: false });
  if (error && isMissingBackendResourceError(error)) return [];
  if (error) throw error;

  const rows = (data ?? []) as Array<{ thread?: GroupThreadItem | GroupThreadItem[] | null }>;
  const result = rows
    .map((row) => (Array.isArray(row.thread) ? row.thread[0] : row.thread))
    .filter((row): row is GroupThreadItem => !!row);
  groupThreadsCache = { userId: myId, data: result, ts: Date.now() };
  return result;
}

export async function listGroupThreadsWithPreview(): Promise<GroupThreadWithPreview[]> {
  const { data: authData } = await supabase.auth.getUser();
  const myId = authData.user?.id;
  if (!myId) return [];

  if (
    groupThreadPreviewsCache &&
    groupThreadPreviewsCache.userId === myId &&
    Date.now() - groupThreadPreviewsCache.ts < GROUP_THREADS_CACHE_TTL_MS
  ) {
    return groupThreadPreviewsCache.data;
  }

  type PreviewRpcRow = {
    id: string;
    title: string;
    owner_id: string;
    avatar_url: string | null;
    created_at: string;
    member_count: number;
    last_message_body: string | null;
    last_message_at: string | null;
    last_sender_id: string | null;
  };

  const { data: rpcRows, error: rpcError } = await (supabase.rpc as any)('list_group_threads_with_preview', {
    p_limit: 50,
  });
  if (!rpcError && Array.isArray(rpcRows)) {
    const mapped = (rpcRows as PreviewRpcRow[])
      .map((row) => ({
        id: row.id,
        title: row.title,
        owner_id: row.owner_id,
        avatar_url: row.avatar_url ?? null,
        created_at: row.created_at,
        member_count: Number.isFinite(row.member_count) ? row.member_count : 0,
        last_message_body: row.last_message_body ?? null,
        last_message_at: row.last_message_at ?? null,
        last_sender_id: row.last_sender_id ?? null,
      }))
      .filter((row) => isUuidLike(row.id));
    if (mapped.length > 0) {
      groupThreadPreviewsCache = { userId: myId, data: mapped, ts: Date.now() };
      return mapped;
    }
  }

  const threads = await listMyGroupThreads();
  if (!threads.length) return [];

  const threadIds = threads.map((thread) => thread.id);
  const [memberRowsResult, messageRowsResult] = await Promise.all([
    (supabase.from('group_thread_members') as any)
      .select('thread_id')
      .in('thread_id', threadIds),
    (supabase.from('group_messages') as any)
      .select('thread_id, body, created_at, sender_id')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  if (memberRowsResult.error && !isMissingBackendResourceError(memberRowsResult.error)) {
    throw memberRowsResult.error;
  }
  if (messageRowsResult.error && !isMissingBackendResourceError(messageRowsResult.error)) {
    throw messageRowsResult.error;
  }

  const memberCountByThread = new Map<string, number>();
  const memberRows = (memberRowsResult.data ?? []) as Array<{ thread_id: string }>;
  for (const row of memberRows) {
    memberCountByThread.set(row.thread_id, (memberCountByThread.get(row.thread_id) ?? 0) + 1);
  }

  const latestByThread = new Map<string, { body: string | null; created_at: string; sender_id: string | null }>();
  const messageRows = (messageRowsResult.data ?? []) as Array<{
    thread_id: string;
    body: string | null;
    created_at: string;
    sender_id: string | null;
  }>;
  for (const row of messageRows) {
    if (!latestByThread.has(row.thread_id)) {
      latestByThread.set(row.thread_id, {
        body: row.body ?? null,
        created_at: row.created_at,
        sender_id: row.sender_id ?? null,
      });
    }
  }

  const result = threads
    .map((thread) => {
      const latest = latestByThread.get(thread.id);
      return {
        ...thread,
        member_count: memberCountByThread.get(thread.id) ?? 0,
        last_message_body: latest?.body ?? null,
        last_message_at: latest?.created_at ?? null,
        last_sender_id: latest?.sender_id ?? null,
      };
    })
    .sort((a, b) => {
      const aTs = new Date(a.last_message_at ?? a.created_at).getTime();
      const bTs = new Date(b.last_message_at ?? b.created_at).getTime();
      return bTs - aTs;
    });
  groupThreadPreviewsCache = { userId: myId, data: result, ts: Date.now() };
  return result;
}

export async function listGroupThreadMembers(threadId: string): Promise<GroupThreadMemberItem[]> {
  const { data, error } = await (supabase.from('group_thread_members') as any)
    .select('id, thread_id, user_id, role, joined_at, profile:profiles!user_id(username, avatar_url)')
    .eq('thread_id', threadId)
    .order('joined_at', { ascending: true });
  if (error && isMissingBackendResourceError(error)) return [];
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    thread_id: string;
    user_id: string;
    role: string;
    joined_at: string;
    profile?: { username?: string | null; avatar_url?: string | null } | { username?: string | null; avatar_url?: string | null }[] | null;
  }>;

  return rows.map((row) => {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    return {
      id: row.id,
      thread_id: row.thread_id,
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
      username: profile?.username ?? null,
      avatar_url: profile?.avatar_url ?? null,
    };
  });
}

export async function listGroupMessages(threadId: string): Promise<GroupMessageItem[]> {
  const { data, error } = await (supabase.from('group_messages') as any)
    .select('id, thread_id, sender_id, body, message_type, media_path, metadata, created_at, sender:profiles!sender_id(username, avatar_url)')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error && isMissingBackendResourceError(error)) return [];
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    thread_id: string;
    sender_id: string;
    body: string;
    message_type: string;
    media_path: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    sender?: { username?: string | null; avatar_url?: string | null } | { username?: string | null; avatar_url?: string | null }[] | null;
  }>;

  return rows.map((row) => {
    const sender = Array.isArray(row.sender) ? row.sender[0] : row.sender;
    return {
      id: row.id,
      thread_id: row.thread_id,
      sender_id: row.sender_id,
      body: row.body,
      message_type: row.message_type,
      media_path: row.media_path ?? null,
      metadata: row.metadata ?? {},
      created_at: row.created_at,
      sender_username: sender?.username ?? null,
      sender_avatar_url: sender?.avatar_url ?? null,
    };
  });
}

export async function sendGroupMessage(threadId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const { data: authData } = await supabase.auth.getUser();
  const myId = authData.user?.id;
  if (!myId) throw new Error('Not authenticated');
  const { error } = await (supabase.from('group_messages') as any).insert({
    thread_id: threadId,
    sender_id: myId,
    body: trimmed,
    message_type: 'text',
  });
  if (error && isMissingBackendResourceError(error)) {
    throw new Error('Group chats are not enabled on backend yet.');
  }
  if (error) throw error;
  invalidateGroupThreadCaches();
}

export async function addGroupThreadMember(threadId: string, userId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)('add_group_thread_member', {
    p_thread_id: threadId,
    p_user_id: userId,
  });
  if (error && isMissingBackendResourceError(error)) {
    throw new Error('Group member management is not enabled on backend yet.');
  }
  if (error) throw error;
  invalidateGroupThreadCaches();
}

export async function removeGroupThreadMember(threadId: string, userId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)('remove_group_thread_member', {
    p_thread_id: threadId,
    p_user_id: userId,
  });
  if (error && isMissingBackendResourceError(error)) {
    throw new Error('Group member management is not enabled on backend yet.');
  }
  if (error) throw error;
  invalidateGroupThreadCaches();
}

export function invalidateGroupThreadCaches(): void {
  groupThreadsCache = null;
  groupThreadPreviewsCache = null;
}

export async function togglePhotoFavorite(photoId: string): Promise<boolean> {
  const { data: authData } = await supabase.auth.getUser();
  const myId = authData.user?.id;
  if (!myId) throw new Error('Not authenticated');

  const { data: existing, error: existingError } = await (supabase.from('user_photo_favorites') as any)
    .select('id')
    .eq('user_id', myId)
    .eq('photo_id', photoId)
    .maybeSingle();
  if (existingError && isMissingBackendResourceError(existingError)) return false;
  if (existingError) throw existingError;
  if (existing?.id) {
    const { error } = await (supabase.from('user_photo_favorites') as any).delete().eq('id', existing.id);
    if (error && isMissingBackendResourceError(error)) return false;
    if (error) throw error;
    return false;
  }

  const { error } = await (supabase.from('user_photo_favorites') as any).insert({
    user_id: myId,
    photo_id: photoId,
  });
  if (error && isMissingBackendResourceError(error)) return false;
  if (error) throw error;
  return true;
}

export async function listFavoritePhotoIds(): Promise<string[]> {
  const { data: authData } = await supabase.auth.getUser();
  const myId = authData.user?.id;
  if (!myId) return [];

  const { data, error } = await (supabase.from('user_photo_favorites') as any)
    .select('photo_id')
    .eq('user_id', myId)
    .order('created_at', { ascending: false });
  if (error && isMissingBackendResourceError(error)) return [];
  if (error) throw error;
  return ((data ?? []) as Array<{ photo_id: string }>).map((row) => row.photo_id);
}

export async function getFriendshipStreaks(limit = 20): Promise<Array<{
  friend_id: string;
  streak_days: number;
  points: number;
  last_interaction: string | null;
}>> {
  const { data, error } = await (supabase.rpc as any)('get_friendship_streaks', {
    p_limit: limit,
  });
  if (error && isMissingBackendResourceError(error)) return [];
  if (error) throw error;
  return (data ?? []) as Array<{
    friend_id: string;
    streak_days: number;
    points: number;
    last_interaction: string | null;
  }>;
}

export async function logSnapScreenshotEvent(snapId: string, platform: string): Promise<void> {
  const { data: authData } = await supabase.auth.getUser();
  const myId = authData.user?.id;
  if (!myId) return;
  const { error } = await (supabase.from('snap_screenshot_events') as any).insert({
    snap_id: snapId,
    user_id: myId,
    platform,
  });
  if (error) return;
}
