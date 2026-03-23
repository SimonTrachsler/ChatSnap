import type { User, Session } from '@supabase/supabase-js';
import { create } from 'zustand';

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  sessionExpired: boolean;
  setAuth: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  setSessionExpired: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  sessionExpired: false,
  setAuth: (session) =>
    set({
      session,
      user: session?.user ?? null,
    }),
  setLoading: (loading) => set({ loading }),
  setSessionExpired: (value) => set({ sessionExpired: value }),
}));

/** Convenience: eingeloggt = User vorhanden */
export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => !!s.user);
}
