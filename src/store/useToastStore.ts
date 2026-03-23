import { create } from 'zustand';

const AUTO_DISMISS_MS = 3000;

interface ToastState {
  message: string | null;
  show: (msg: string) => void;
  clear: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (msg) => {
    if (timer) clearTimeout(timer);
    set({ message: msg });
    timer = setTimeout(() => {
      set({ message: null });
      timer = null;
    }, AUTO_DISMISS_MS);
  },
  clear: () => {
    if (timer) { clearTimeout(timer); timer = null; }
    set({ message: null });
  },
}));
