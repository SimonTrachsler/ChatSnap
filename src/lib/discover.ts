import { callRpc, supabase } from '@/lib/supabase';

export type DiscoverUser = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

type DiscoverUserRow = {
  id?: unknown;
  username?: unknown;
  avatar_url?: unknown;
};

type GetDiscoverUsersOptions = {
  forceRefresh?: boolean;
};

const DISCOVER_CACHE_TTL_MS = 20_000;

type DiscoverCacheEntry = {
  data: DiscoverUser[];
  ts: number;
};

const discoverCache = new Map<string, DiscoverCacheEntry>();
const discoverInFlight = new Map<string, Promise<DiscoverUser[]>>();

function getDiscoverCacheKey(limit: number, currentUserId?: string): string {
  return `${currentUserId ?? 'anonymous'}:${Math.max(1, limit)}`;
}

function readDiscoverCache(key: string): DiscoverUser[] | null {
  const cached = discoverCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > DISCOVER_CACHE_TTL_MS) {
    discoverCache.delete(key);
    return null;
  }
  return cached.data;
}

function writeDiscoverCache(key: string, data: DiscoverUser[]): void {
  discoverCache.set(key, { data, ts: Date.now() });
}

function normalizeDiscoverUsers(rows: unknown): DiscoverUser[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const { id, username, avatar_url } = row as DiscoverUserRow;
    if (typeof id !== 'string' || !id.length) return [];
    return [
      {
        id,
        username: typeof username === 'string' ? username : null,
        avatar_url: typeof avatar_url === 'string' ? avatar_url : null,
      },
    ];
  });
}

async function getFallbackDiscoverUsers(limit: number, currentUserId?: string): Promise<DiscoverUser[]> {
  let query = supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .order('created_at', { ascending: false })
    .limit(Math.max(limit * 4, 60));

  if (currentUserId) {
    query = query.neq('id', currentUserId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[discover] fallback profiles query error:', error.message);
    return [];
  }

  return normalizeDiscoverUsers(data);
}

export async function getDiscoverUsers(
  limit: number = 20,
  currentUserId?: string,
  options?: GetDiscoverUsersOptions,
): Promise<DiscoverUser[]> {
  const key = getDiscoverCacheKey(limit, currentUserId);
  const pending = discoverInFlight.get(key);
  if (pending) {
    return pending;
  }

  if (!options?.forceRefresh) {
    const cached = readDiscoverCache(key);
    if (cached) {
      return cached;
    }
  }

  const nextRequest = (async () => {
    const { data, error } = await callRpc<DiscoverUser[]>('get_discover_users', {
      p_limit: limit,
    });
    if (error) {
      console.error('[discover] get_discover_users error:', error.message);
      const fallback = await getFallbackDiscoverUsers(limit, currentUserId);
      writeDiscoverCache(key, fallback);
      return fallback;
    }
    const rows = normalizeDiscoverUsers(data);
    if (rows.length > 0) {
      const filtered = currentUserId ? rows.filter((row) => row.id !== currentUserId) : rows;
      writeDiscoverCache(key, filtered);
      return filtered;
    }
    const fallback = data == null ? await getFallbackDiscoverUsers(limit, currentUserId) : rows;
    writeDiscoverCache(key, fallback);
    return fallback;
  })();

  discoverInFlight.set(key, nextRequest);
  try {
    return await nextRequest;
  } finally {
    discoverInFlight.delete(key);
  }
}
