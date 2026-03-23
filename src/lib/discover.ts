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

export async function getDiscoverUsers(limit: number = 20, currentUserId?: string): Promise<DiscoverUser[]> {
  const { data, error } = await callRpc<DiscoverUser[]>('get_discover_users', {
    p_limit: limit,
  });
  if (error) {
    console.error('[discover] get_discover_users error:', error.message);
    return getFallbackDiscoverUsers(limit, currentUserId);
  }
  const rows = normalizeDiscoverUsers(data);
  if (rows.length > 0) {
    return currentUserId ? rows.filter((row) => row.id !== currentUserId) : rows;
  }
  return data == null ? getFallbackDiscoverUsers(limit, currentUserId) : rows;
}
