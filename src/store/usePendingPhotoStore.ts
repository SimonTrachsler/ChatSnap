import { create } from 'zustand';

/**
 * Holds pending photo URIs for the snap-send flow.
 * - pendingPhotoUri: local file:// URI from camera capture
 * - pendingGalleryUri: remote URI for a gallery photo (signed URL or public URL)
 * Starting a draft from either source replaces the previous draft.
 */
export interface PendingPhotoState {
  pendingPhotoUri: string | null;
  setPendingPhotoUri: (uri: string | null) => void;
  pendingGalleryUri: string | null;
  setPendingGalleryUri: (uri: string | null) => void;
  clearAll: () => void;
}

export const usePendingPhotoStore = create<PendingPhotoState>((set) => ({
  pendingPhotoUri: null,
  setPendingPhotoUri: (uri) => set({ pendingPhotoUri: uri, ...(uri === null ? {} : { pendingGalleryUri: null }) }),
  pendingGalleryUri: null,
  setPendingGalleryUri: (uri) => set({ pendingGalleryUri: uri, ...(uri === null ? {} : { pendingPhotoUri: null }) }),
  clearAll: () => set({ pendingPhotoUri: null, pendingGalleryUri: null }),
}));
