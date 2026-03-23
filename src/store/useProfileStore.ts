import type { Database } from '@/types/database';
import { create } from 'zustand';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface ProfileState {
  profile: ProfileRow | null;
  profileError: string | null;
  profileLoading: boolean;
  setProfile: (profile: ProfileRow | null) => void;
  setProfileError: (error: string | null) => void;
  setProfileLoading: (loading: boolean) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  profileError: null,
  profileLoading: false,
  setProfile: (profile) => set({ profile }),
  setProfileError: (profileError) => set({ profileError }),
  setProfileLoading: (profileLoading) => set({ profileLoading }),
}));
