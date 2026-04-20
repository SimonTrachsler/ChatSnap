import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { useActiveThreadStore } from '@/store/useActiveThreadStore';

const PROFILE_NAME_CACHE_TTL_MS = 5 * 60 * 1000;
const REFRESH_DEBOUNCE_MS = 250;

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

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const profileNameCache = new Map<string, { name: string; ts: number }>();
    const profileNameInFlight = new Map<string, Promise<string>>();

    const queueRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshRef.current?.();
      }, REFRESH_DEBOUNCE_MS);
    };

    const resolveSenderName = async (senderId?: string): Promise<string> => {
      if (!senderId) return 'Unknown';
      const now = Date.now();
      const cached = profileNameCache.get(senderId);
      if (cached && now - cached.ts < PROFILE_NAME_CACHE_TTL_MS) return cached.name;

      const inFlight = profileNameInFlight.get(senderId);
      if (inFlight) return inFlight;

      const request = (async () => {
        try {
          const res = await supabase
            .from('profiles')
            .select('username')
            .eq('id', senderId)
            .maybeSingle();
          const name = getProfileUsername(res.data) ?? senderId;
          profileNameCache.set(senderId, { name, ts: Date.now() });
          return name;
        } catch {
          return senderId;
        } finally {
          profileNameInFlight.delete(senderId);
        }
      })();

      profileNameInFlight.set(senderId, request);
      return request;
    };

    const channel = supabase
      .channel('inbox_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'snaps', filter: `recipient_id=eq.${userId}` },
        async (payload) => {
          const senderId = (payload.new as { sender_id?: string }).sender_id;
          const name = await resolveSenderName(senderId);
          showToast(`New snap from ${name}`);
          queueRefresh();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `sender_id=neq.${userId}` },
        async (payload) => {
          const row = payload.new as { sender_id?: string; thread_id?: string };
          if (!row.thread_id) return;

          // Suppress toast if this thread is currently open
          const activeThread = useActiveThreadStore.getState().activeThreadId;
          if (row.thread_id && row.thread_id === activeThread) {
            queueRefresh();
            return;
          }

          const name = await resolveSenderName(row.sender_id);
          showToast(`New message from ${name}`);
          queueRefresh();
        },
      )
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [userId, showToast]);
}
