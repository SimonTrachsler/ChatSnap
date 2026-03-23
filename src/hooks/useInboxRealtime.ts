import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { useActiveThreadStore } from '@/store/useActiveThreadStore';

function getProfileUsername(profile: unknown): string | null {
  if (!profile || typeof profile !== 'object' || !('username' in profile)) return null;
  const username = (profile as { username?: unknown }).username;
  return typeof username === 'string' && username.length > 0 ? username : null;
}

/**
 * Subscribes to Realtime INSERT events on `snaps` and `chat_messages`
 * for the current user, showing a toast for each incoming item.
 * Friend request notifications are handled by the tabs layout subscription.
 *
 * @param onBadgeRefresh – called whenever badge counts should be re-fetched
 */
export function useInboxRealtime(onBadgeRefresh?: () => void) {
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const showToast = useToastStore((s) => s.show);
  const refreshRef = useRef(onBadgeRefresh);
  refreshRef.current = onBadgeRefresh;

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('inbox_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'snaps', filter: `recipient_id=eq.${userId}` },
        async (payload) => {
          const senderId = (payload.new as { sender_id?: string }).sender_id;
          let name = senderId ?? 'Unknown';
          if (senderId) {
            const { data: p } = await supabase
              .from('profiles')
              .select('username')
              .eq('id', senderId)
              .maybeSingle();
            name = getProfileUsername(p) ?? name;
          }
          showToast(`New snap from ${name}`);
          refreshRef.current?.();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        async (payload) => {
          const row = payload.new as { sender_id?: string; thread_id?: string };
          if (row.sender_id === userId) return;

          // Check this thread belongs to the current user
          if (row.thread_id) {
            const { data: thread } = await supabase
              .from('chat_threads')
              .select('id')
              .eq('id', row.thread_id)
              .or(`user_a.eq.${userId},user_b.eq.${userId}`)
              .maybeSingle();
            if (!thread) return;
          }

          // Suppress toast if this thread is currently open
          const activeThread = useActiveThreadStore.getState().activeThreadId;
          if (row.thread_id && row.thread_id === activeThread) {
            refreshRef.current?.();
            return;
          }

          let name = row.sender_id ?? 'Unbekannt';
          if (row.sender_id) {
            const { data: p } = await supabase
              .from('profiles')
              .select('username')
              .eq('id', row.sender_id)
              .maybeSingle();
            name = getProfileUsername(p) ?? name;
          }
          showToast(`New message from ${name}`);
          refreshRef.current?.();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, showToast]);
}
