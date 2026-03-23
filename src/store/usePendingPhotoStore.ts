import { create } from 'zustand';

/**
 * Holds pending photo URIs for the snap-send flow.
 * - pendingPhotoUri: local file:// URI from camera capture
 * - pendingGalleryUri: remote URI for a gallery photo (signed URL or public URL)
 * snap-send.tsx reads whichever is set (gallery takes priority).
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
  setPendingPhotoUri: (uri) => set({ pendingPhotoUri: uri }),
  pendingGalleryUri: null,
  setPendingGalleryUri: (uri) => set({ pendingGalleryUri: uri }),
  clearAll: () => set({ pendingPhotoUri: null, pendingGalleryUri: null }),
}));
