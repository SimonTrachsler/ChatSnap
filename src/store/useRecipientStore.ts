import { create } from 'zustand';

export type SelectedFriend = {
  id: string;
  email: string | null;
};

export interface RecipientState {
  /** Current recipient for camera/send flow (set on Friends tab) */
  selectedFriend: SelectedFriend | null;
  setSelectedFriend: (friend: SelectedFriend | null) => void;
}

export const useRecipientStore = create<RecipientState>((set) => ({
  selectedFriend: null,
  setSelectedFriend: (friend) => set({ selectedFriend: friend }),
}));
