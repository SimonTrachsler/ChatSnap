import { getUpsertClient, supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type FriendAliasInsert = Database['public']['Tables']['friend_aliases']['Insert'];
const friendAliasesUpsertClient = getUpsertClient<FriendAliasInsert>('friend_aliases');

/**
 * Get the local alias (nickname) the current user has set for a friend.
 * Returns null if no alias is set.
 */
export async function getAlias(friendId: string): Promise<string | null> {
  const { data: user } = await supabase.auth.getUser();
  const ownerId = user?.user?.id;
  if (!ownerId) return null;

  const { data, error } = await supabase
    .from('friend_aliases')
    .select('alias')
    .eq('owner_id', ownerId)
    .eq('friend_id', friendId)
    .maybeSingle();

  if (error) throw error;
  return (data as { alias?: string | null } | null)?.alias ?? null;
}

/**
 * Set or remove the local alias for a friend.
 * Pass null or empty string to remove the alias.
 */
export async function setAlias(friendId: string, alias: string | null): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  const ownerId = user?.user?.id;
  if (!ownerId) throw new Error('Not authenticated');

  const trimmed = alias?.trim() || null;

  if (!trimmed) {
    await supabase
      .from('friend_aliases')
      .delete()
      .eq('owner_id', ownerId)
      .eq('friend_id', friendId);
    return;
  }

  const aliasRow: FriendAliasInsert = { owner_id: ownerId, friend_id: friendId, alias: trimmed };
  const { error } = await friendAliasesUpsertClient.upsert(aliasRow, { onConflict: 'owner_id,friend_id' });
  if (error) throw error;
}
