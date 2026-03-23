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

async function fallbackSearchProfiles(query: string): Promise<ProfileSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { data: authData } = await supabase.auth.getUser();
  const currentUserId = authData.user?.id ?? null;

  let request = supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .ilike('username', `%${trimmed}%`)
    .order('username', { ascending: true })
    .limit(20);

  if (currentUserId) {
    request = request.neq('id', currentUserId);
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
export async function searchProfiles(query: string): Promise<ProfileSearchResult[]> {
  const { data, error } = await callRpc<ProfileSearchResult[]>('search_profiles', {
    query: query?.trim() ?? '',
  });

  if (error) {
    console.error('[profileSearch] search_profiles RPC error:', formatSupabaseDebug(error), error);
    return fallbackSearchProfiles(query);
  }

  const rows = normalizeProfileResults(data);
  if (rows.length > 0 || Array.isArray(data)) {
    return rows;
  }

  return fallbackSearchProfiles(query);
}
