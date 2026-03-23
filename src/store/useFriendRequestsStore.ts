import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';

export interface FriendRequestsState {
  /** Number of incoming pending friend requests (receiver_id = auth.uid()) */
  pendingIncomingCount: number;
  setPendingIncomingCount: (n: number) => void;
  /** Fetches count and updates store; call on mount and when Friends tab is focused */
  refreshPendingIncoming: () => Promise<void>;
}

export const useFriendRequestsStore = create<FriendRequestsState>((set, _get) => ({
  pendingIncomingCount: 0,
  setPendingIncomingCount: (n) => set({ pendingIncomingCount: n }),

  refreshPendingIncoming: async () => {
    const uid = useAuthStore.getState().user?.id ?? null;
    if (!uid) {
      set({ pendingIncomingCount: 0 });
      return;
    }
    const { count, error } = await supabase
      .from('friend_requests')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', uid)
      .eq('status', 'pending');

    if (error) {
      return;
    }
    set({ pendingIncomingCount: typeof count === 'number' ? count : 0 });
  },
}));
