import { create } from 'zustand';

interface ActiveThreadState {
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
}

export const useActiveThreadStore = create<ActiveThreadState>((set) => ({
  activeThreadId: null,
  setActiveThreadId: (id) => set({ activeThreadId: id }),
}));
