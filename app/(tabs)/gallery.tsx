import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Pressable,
  StyleSheet,
  Dimensions,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { usePendingPhotoStore } from '@/store/usePendingPhotoStore';
import { LoadingScreen } from '@/components/LoadingScreen';
import { EmptyState } from '@/ui/components/EmptyState';
import { PageHeader } from '@/ui/components/PageHeader';
import { colors, radius } from '@/ui/theme';
import { getUserPhotoStoragePath } from '@/lib/userPhotos';
import { listFavoritePhotoIds, togglePhotoFavorite } from '@/lib/socialFeatures';

type UserPhoto = {
  id: string;
  created_at: string;
  storage_path: string;
};

const USER_PHOTOS_BUCKET = 'user-photos';
const SIGNED_URL_EXPIRY = 3600;
const SIGNED_URL_SAFE_TTL_MS = SIGNED_URL_EXPIRY * 1000 - 45_000;
const FOCUS_REFRESH_COOLDOWN_MS = 2500;
const GAP = 8;
const PADDING = 24;

type SignedUrlCacheEntry = {
  url: string;
  expiresAt: number;
};

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();

function readSignedUrlCache(storagePath: string): string | null {
  const cached = signedUrlCache.get(storagePath);
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt) {
    signedUrlCache.delete(storagePath);
    return null;
  }
  return cached.url;
}

function writeSignedUrlCache(storagePath: string, signedUrl: string): void {
  signedUrlCache.set(storagePath, {
    url: signedUrl,
    expiresAt: Date.now() + Math.max(60_000, SIGNED_URL_SAFE_TTL_MS),
  });
}

export default function GalleryScreen() {
  const router = useRouter();
  const { refresh } = useLocalSearchParams<{ refresh?: string }>();
  const userId = useAuthStore((s) => s.user?.id);
  const setPendingGalleryUri = usePendingPhotoStore((s) => s.setPendingGalleryUri);
  const { width: screenWidth } = useWindowDimensions();
  const itemSize = (screenWidth - PADDING * 2 - GAP * 2) / 3;
  const hasLoadedOnceRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const requestRef = useRef(0);

  const [photos, setPhotos] = useState<UserPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<UserPhoto | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const selectedPhotoUri = selectedPhoto ? (urls[selectedPhoto.id] ?? null) : null;
  const selectedIsFavorite = selectedPhoto ? favoriteIds.has(selectedPhoto.id) : false;

  const resolveSignedUrls = useCallback(async (list: UserPhoto[]): Promise<Record<string, string>> => {
    const byPhotoId: Record<string, string> = {};
    const pathByPhotoId = new Map<string, string>();
    const missingPaths = new Set<string>();

    for (const photo of list) {
      const storagePath = getUserPhotoStoragePath(photo);
      if (!storagePath) continue;
      const cached = readSignedUrlCache(storagePath);
      if (cached) {
        byPhotoId[photo.id] = cached;
        continue;
      }
      pathByPhotoId.set(photo.id, storagePath);
      missingPaths.add(storagePath);
    }

    const missingPathList = Array.from(missingPaths);
    const signedByPath = new Map<string, string>();
    const storage = supabase.storage.from(USER_PHOTOS_BUCKET) as unknown as {
      createSignedUrls?: (
        paths: string[],
        expiresIn: number,
      ) => Promise<{
        data?: Array<{ path?: string | null; signedUrl?: string | null }>;
        error?: { message?: string } | null;
      }>;
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data?: { signedUrl?: string | null } | null }>;
    };

    if (missingPathList.length && typeof storage.createSignedUrls === 'function') {
      const batch = await storage.createSignedUrls(missingPathList, SIGNED_URL_EXPIRY);
      for (const row of batch.data ?? []) {
        if (typeof row?.path !== 'string' || typeof row?.signedUrl !== 'string') continue;
        signedByPath.set(row.path, row.signedUrl);
        writeSignedUrlCache(row.path, row.signedUrl);
      }
    }

    const unresolvedPaths = missingPathList.filter((path) => !signedByPath.has(path));
    if (unresolvedPaths.length) {
      const fallbackResults = await Promise.all(
        unresolvedPaths.map(async (path) => {
          const { data } = await storage.createSignedUrl(path, SIGNED_URL_EXPIRY);
          return data?.signedUrl ? ([path, data.signedUrl] as const) : null;
        }),
      );
      for (const pair of fallbackResults) {
        if (!pair) continue;
        signedByPath.set(pair[0], pair[1]);
        writeSignedUrlCache(pair[0], pair[1]);
      }
    }

    for (const [photoId, path] of pathByPhotoId.entries()) {
      const signedUrl = signedByPath.get(path);
      if (signedUrl) byPhotoId[photoId] = signedUrl;
    }

    return byPhotoId;
  }, []);

  const loadGallery = useCallback(async (options?: { force?: boolean }) => {
    if (!userId) {
      startTransition(() => {
        setPhotos([]);
        setUrls({});
      });
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const force = options?.force === true;
    if (!force && hasLoadedOnceRef.current && Date.now() - lastLoadedAtRef.current < FOCUS_REFRESH_COOLDOWN_MS) {
      return;
    }

    const req = requestRef.current + 1;
    requestRef.current = req;
    const isStale = () => requestRef.current !== req;

    const firstLoad = !hasLoadedOnceRef.current;
    if (firstLoad) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [photosResult, favoriteList] = await Promise.all([
        supabase
          .from('user_photos')
          .select('id, created_at, storage_path')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        listFavoritePhotoIds().catch(() => [] as string[]),
      ]);

      if (isStale()) return;
      if (photosResult.error) {
        setError(photosResult.error.message);
        return;
      }

      const list = (photosResult.data ?? []) as UserPhoto[];
      startTransition(() => {
        setPhotos(list);
        setUrls((prev) => {
          const next: Record<string, string> = {};
          for (const photo of list) {
            if (prev[photo.id]) next[photo.id] = prev[photo.id];
          }
          return next;
        });
        setFavoriteIds(new Set(favoriteList));
      });

      const resolvedUrls = await resolveSignedUrls(list);
      if (isStale()) return;
      startTransition(() => {
        setUrls((prev) => ({ ...prev, ...resolvedUrls }));
      });

      hasLoadedOnceRef.current = true;
      lastLoadedAtRef.current = Date.now();
    } catch (e) {
      if (!isStale()) setError(e instanceof Error ? e.message : 'Failed to load gallery.');
    } finally {
      if (!isStale()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [resolveSignedUrls, userId]);

  useFocusEffect(useCallback(() => { loadGallery(); }, [loadGallery]));
  useEffect(() => { if (refresh && userId) loadGallery({ force: true }); }, [refresh, userId, loadGallery]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('user_photos_changes')
      .on('postgres_changes', { schema: 'public', table: 'user_photos', filter: `user_id=eq.${userId}`, event: 'INSERT' },
        async (payload) => {
          const row = payload.new as UserPhoto;
          const storagePath = getUserPhotoStoragePath(row);
          let signedUrl: string | null = null;
          if (storagePath) {
            const cached = readSignedUrlCache(storagePath);
            if (cached) {
              signedUrl = cached;
            } else {
              const { data: signedData } = await supabase.storage.from(USER_PHOTOS_BUCKET).createSignedUrl(storagePath, SIGNED_URL_EXPIRY);
              signedUrl = signedData?.signedUrl ?? null;
              if (signedUrl) writeSignedUrlCache(storagePath, signedUrl);
            }
          }
          startTransition(() => {
            setPhotos((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev]));
            if (signedUrl) setUrls((prev) => ({ ...prev, [row.id]: signedUrl! }));
          });
        })
      .on('postgres_changes', { schema: 'public', table: 'user_photos', filter: `user_id=eq.${userId}`, event: 'DELETE' },
        (payload) => {
          const row = payload.old as { id: string };
          startTransition(() => {
            setPhotos((prev) => prev.filter((p) => p.id !== row.id));
            setUrls((prev) => {
              const next = { ...prev };
              delete next[row.id];
              return next;
            });
            setFavoriteIds((prev) => {
              const next = new Set(prev);
              next.delete(row.id);
              return next;
            });
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const closePreview = useCallback(() => { setSelectedPhoto(null); setModalError(null); }, []);

  const handleSendToFriend = useCallback(() => {
    if (!selectedPhoto) return;
    const imageUri = urls[selectedPhoto.id] ?? null;
    if (!imageUri) { setModalError('Image URL not available.'); return; }
    setPendingGalleryUri(imageUri);
    closePreview();
    router.push('/(tabs)/snap-send');
  }, [selectedPhoto, urls, setPendingGalleryUri, closePreview, router]);

  const handleToggleFavorite = useCallback(async () => {
    if (!selectedPhoto) return;
    try {
      const enabled = await togglePhotoFavorite(selectedPhoto.id);
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(selectedPhoto.id);
        else next.delete(selectedPhoto.id);
        return next;
      });
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Could not update favorite.');
    }
  }, [selectedPhoto]);

  const handleDeletePhoto = useCallback(async () => {
    if (!selectedPhoto) return;
    Alert.alert('Delete photo', 'Delete this photo permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleteLoading(true);
          setModalError(null);
          try {
            const storagePath = getUserPhotoStoragePath(selectedPhoto);
            if (!storagePath) throw new Error('Could not determine storage path.');
            const { error: storageError } = await supabase.storage.from(USER_PHOTOS_BUCKET).remove([storagePath]);
            if (storageError) throw new Error(storageError.message);
            const { error: rowError } = await supabase.from('user_photos').delete().eq('id', selectedPhoto.id);
            if (rowError) throw new Error(rowError.message);
            closePreview();
          } catch (e) {
            setModalError(e instanceof Error ? e.message : 'Delete failed.');
          } finally {
            setDeleteLoading(false);
          }
        },
      },
    ]);
  }, [selectedPhoto, closePreview]);

  if (!userId) {
    return (
      <View style={styles.centered}>
        <PageHeader title="Gallery" />
        <EmptyState icon="log-in-outline" title="Not signed in" />
      </View>
    );
  }

  if (loading && !hasLoadedOnceRef.current) return <LoadingScreen message="Loading gallery..." />;

  return (
    <View style={styles.container}>
      <FlatList<UserPhoto>
        data={photos}
        keyExtractor={(item: UserPhoto) => item.id}
        extraData={urls}
        numColumns={3}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.columnWrapper}
        initialNumToRender={12}
        windowSize={7}
        maxToRenderPerBatch={12}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadGallery({ force: true })} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View>
            <PageHeader title="Gallery" />
            {error ? <Text style={styles.headerError}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="images-outline"
            title="No photos saved."
            subtitle="Photos you save from the camera will appear here."
          />
        }
        renderItem={({ item }: { item: UserPhoto }) => {
          const uri = urls[item.id] ?? null;
          return (
            <TouchableOpacity
              style={[styles.cell, { width: itemSize, height: itemSize }]}
              onPress={() => setSelectedPhoto(item)}
              activeOpacity={0.9}
            >
              {uri ? (
                <ExpoImage source={{ uri }} style={styles.thumb} contentFit="cover" transition={180} />
              ) : (
                <View style={styles.thumbPlaceholder}>
                  <Ionicons name="image-outline" size={24} color={colors.textMuted} />
                </View>
              )}
              {favoriteIds.has(item.id) ? (
                <View style={styles.favoriteBadge}>
                  <Ionicons name="heart" size={14} color={colors.accent} />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={<View style={styles.footerSpace} />}
      />

      <Modal visible={!!selectedPhoto} transparent animationType="fade" onRequestClose={closePreview}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.absoluteFill} onPress={closePreview} />
          {selectedPhoto && (
            <>
              {selectedPhotoUri ? (
                <ExpoImage
                  source={{ uri: selectedPhotoUri }}
                  style={styles.previewImage}
                  contentFit="contain"
                  transition={180}
                />
              ) : (
                <View style={[styles.previewImage, styles.previewFallback]}>
                  <Ionicons name="image-outline" size={32} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.modalActions} pointerEvents="box-none">
                <View style={styles.modalButtonsRow}>
                  <TouchableOpacity
                    onPress={handleToggleFavorite}
                    disabled={deleteLoading}
                    style={[styles.modalButton, styles.modalButtonSecondary]}
                  >
                    <Ionicons
                      name={selectedIsFavorite ? 'heart' : 'heart-outline'}
                      size={16}
                      color={colors.textPrimary}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.modalButtonText}>
                      {selectedIsFavorite ? 'Unfavorite' : 'Favorite'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSendToFriend}
                    disabled={deleteLoading}
                    style={[styles.modalButton, styles.modalButtonPrimary]}
                  >
                    <Ionicons name="send" size={16} color={colors.onAccent} style={{ marginRight: 6 }} />
                    <Text style={styles.modalButtonTextDark}>Send</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleDeletePhoto}
                    disabled={deleteLoading}
                    style={[styles.modalButton, styles.modalButtonDanger]}
                  >
                    {deleteLoading ? (
                      <ActivityIndicator color={colors.textPrimary} size="small" />
                    ) : (
                      <>
                        <Ionicons name="trash-outline" size={16} color={colors.textPrimary} style={{ marginRight: 6 }} />
                        <Text style={styles.modalButtonText}>Delete</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
                {modalError ? <Text style={styles.modalErrorText}>{modalError}</Text> : null}
                <TouchableOpacity onPress={closePreview} style={styles.modalCloseButton}>
                  <Text style={styles.modalCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  listContent: { paddingHorizontal: PADDING, paddingBottom: 150 },
  columnWrapper: { gap: GAP, marginBottom: GAP },
  headerError: {
    marginBottom: 16,
    paddingHorizontal: 24,
    color: colors.error,
    fontSize: 14,
  },
  cell: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  thumb: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgCardAlt,
  },
  favoriteBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,9,17,0.75)',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  previewFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgCardAlt,
  },
  centered: { flex: 1, backgroundColor: 'transparent' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(4,9,17,0.94)', justifyContent: 'center', alignItems: 'center' },
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  previewImage: { width: Dimensions.get('window').width, height: Dimensions.get('window').height },
  modalActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
    backgroundColor: colors.overlay,
    borderTopWidth: 1,
    borderTopColor: colors.bgCardBorder,
  },
  modalButtonsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  modalButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 15,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  modalButtonPrimary: { backgroundColor: colors.accent },
  modalButtonSecondary: { backgroundColor: colors.bgCardAlt, borderWidth: 1, borderColor: colors.bgCardBorder },
  modalButtonDanger: { backgroundColor: 'rgba(251,113,133,0.2)', borderWidth: 1, borderColor: 'rgba(251,113,133,0.35)' },
  modalButtonText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  modalButtonTextDark: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  modalErrorText: { color: colors.error, fontSize: 14, marginBottom: 8, textAlign: 'center' },
  modalCloseButton: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20 },
  modalCloseText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  footerSpace: { height: 24 },
});
