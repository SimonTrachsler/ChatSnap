import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface InboxBadgeState {
  unreadMessages: number;
  setUnreadMessages: (n: number) => void;
  refreshUnreadMessages: () => Promise<void>;
}

export const useInboxBadgeStore = create<InboxBadgeState>((set, _get) => ({
  unreadMessages: 0,
  setUnreadMessages: (n) => set({ unreadMessages: n }),

  refreshUnreadMessages: async () => {
    const { data, error } = await supabase.rpc('count_unread_messages');
    if (error) return;
    set({ unreadMessages: typeof data === 'number' ? data : 0 });
  },
}));
