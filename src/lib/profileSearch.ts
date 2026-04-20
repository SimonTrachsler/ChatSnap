/**
 * Search profiles by username (case-insensitive contains).
 * Uses RPC search_profiles; excludes the current logged-in user.
 */

import { callRpc, supabase } from '@/lib/supabase';
import { supabaseErrorToUserMessage } from '@/lib/supabaseErrors';

export type ProfileSearchResult = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

type ProfileSearchOptions = {
  currentUserId?: string | null;
  forceRefresh?: boolean;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type ProfileSearchRow = {
  id?: unknown;
  username?: unknown;
  avatar_url?: unknown;
};

const PROFILE_SEARCH_CACHE_TTL_MS = 20_000;

type ProfileSearchCacheEntry = {
  data: ProfileSearchResult[];
  ts: number;
};

const profileSearchCache = new Map<string, ProfileSearchCacheEntry>();
const profileSearchInFlight = new Map<string, Promise<ProfileSearchResult[]>>();

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function makeSearchCacheKey(query: string, currentUserId?: string | null): string {
  return `${currentUserId ?? 'anonymous'}:${query}`;
}

function readSearchCache(key: string): ProfileSearchResult[] | null {
  const cached = profileSearchCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > PROFILE_SEARCH_CACHE_TTL_MS) {
    profileSearchCache.delete(key);
    return null;
  }
  return cached.data;
}

function writeSearchCache(key: string, data: ProfileSearchResult[]): void {
  profileSearchCache.set(key, { data, ts: Date.now() });
}

function formatSupabaseDebug(error: SupabaseErrorLike): string {
  return `${error.code ?? ''} | ${error.message ?? ''} | ${error.details ?? ''} | ${error.hint ?? ''}`;
}

function normalizeProfileResults(rows: unknown): ProfileSearchResult[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const { id, username, avatar_url } = row as ProfileSearchRow;
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

async function resolveCurrentUserId(currentUserId?: string | null): Promise<string | null> {
  if (currentUserId) return currentUserId;
  const { data: authData } = await supabase.auth.getUser();
  return authData.user?.id ?? null;
}

async function fallbackSearchProfiles(query: string, currentUserId?: string | null): Promise<ProfileSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const currentUser = await resolveCurrentUserId(currentUserId);

  let request = supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .ilike('username', `%${trimmed}%`)
    .order('username', { ascending: true })
    .limit(20);

  if (currentUser) {
    request = request.neq('id', currentUser);
  }

  const { data, error } = await request;
  if (error) {
    console.error('[profileSearch] fallback profiles query error:', formatSupabaseDebug(error), error);
    throw new Error(supabaseErrorToUserMessage(error));
  }

  return normalizeProfileResults(data);
}

/**
 * Search users by username (case-insensitive contains).
 * RPC search_profiles: id, username, avatar_url; limit 20; excludes current user.
 * @returns Array of { id, username, avatar_url }
 */
export async function searchProfiles(
  query: string,
  options?: ProfileSearchOptions,
): Promise<ProfileSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const normalized = normalizeSearchQuery(trimmed);
  const currentUserId = await resolveCurrentUserId(options?.currentUserId);
  const key = makeSearchCacheKey(normalized, currentUserId);
  const pending = profileSearchInFlight.get(key);
  if (pending) {
    return pending;
  }

  if (!options?.forceRefresh) {
    const cached = readSearchCache(key);
    if (cached) {
      return cached;
    }
  }

  const nextRequest = (async () => {
    const { data, error } = await callRpc<ProfileSearchResult[]>('search_profiles', {
      query: trimmed,
    });

    if (error) {
      console.error('[profileSearch] search_profiles RPC error:', formatSupabaseDebug(error), error);
      const fallback = await fallbackSearchProfiles(trimmed, currentUserId);
      writeSearchCache(key, fallback);
      return fallback;
    }

    const rows = normalizeProfileResults(data);
    if (rows.length > 0 || Array.isArray(data)) {
      writeSearchCache(key, rows);
      return rows;
    }

    const fallback = await fallbackSearchProfiles(trimmed, currentUserId);
    writeSearchCache(key, fallback);
    return fallback;
  })();

  profileSearchInFlight.set(key, nextRequest);
  try {
    return await nextRequest;
  } finally {
    profileSearchInFlight.delete(key);
  }
}
