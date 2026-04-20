import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface InboxBadgeState {
  unreadMessages: number;
  setUnreadMessages: (n: number) => void;
  decrementUnreadMessages: (amount?: number) => void;
  refreshUnreadMessages: (options?: { force?: boolean }) => Promise<void>;
}

let refreshInFlight: Promise<void> | null = null;
let lastRefreshAt = 0;
const REFRESH_DEBOUNCE_MS = 1_200;

export const useInboxBadgeStore = create<InboxBadgeState>((set, _get) => ({
  unreadMessages: 0,
  setUnreadMessages: (n) => set({ unreadMessages: Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0) }),
  decrementUnreadMessages: (amount = 1) =>
    set((state) => ({ unreadMessages: Math.max(0, state.unreadMessages - Math.max(1, Math.floor(amount))) })),

  refreshUnreadMessages: async (options) => {
    const force = options?.force === true;
    const now = Date.now();
    if (!force && now - lastRefreshAt < REFRESH_DEBOUNCE_MS) return;
    if (!force && refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const { data, error } = await supabase.rpc('count_unread_messages');
      if (error) return;
      set({ unreadMessages: typeof data === 'number' ? Math.max(0, Math.floor(data)) : 0 });
      lastRefreshAt = Date.now();
    })();

    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  },
}));
