import { memo, startTransition, useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { usePendingPhotoStore } from '@/store/usePendingPhotoStore';
import { useAuthStore } from '@/store/useAuthStore';
import { listFriends, type FriendListItem } from '@/lib/friendRequests';
import { createSnapWithImage } from '@/lib/snapSend';
import { getOrCreateThread, sendSnapMessage } from '@/lib/chat';
import { uriToBase64, blobToBase64 } from '@/lib/uploadHelper';
import { reportError, trackEvent } from '@/lib/telemetry';
import { createStoryFromUri } from '@/lib/socialFeatures';
import { AppButton } from '@/ui/components/AppButton';
import { Avatar } from '@/ui/components/Avatar';
import { EmptyState } from '@/ui/components/EmptyState';
import { PageHeader } from '@/ui/components/PageHeader';
import { Card } from '@/ui/components/Card';
import { colors, radius, spacing } from '@/ui/theme';

const MAX_IMAGE_WIDTH = 1080;
const COMPRESS_QUALITY = 0.7;

function base64ToUint8Array(b64: string): Uint8Array {
  const raw = b64.replace(/^data:image\/\w+;base64,/, '').trim();
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function remoteUriToBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Could not download image (${response.status}).`);
  }
  const blob = await response.blob();
  const base64 = await blobToBase64(blob);
  return base64ToUint8Array(base64);
}

const RecipientRow = memo(function RecipientRow({
  item,
  selected,
  onToggle,
}: {
  item: FriendListItem;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const displayName = item.username ?? item.email ?? item.id.slice(0, 8);

  return (
    <TouchableOpacity style={styles.friendTouchable} onPress={() => onToggle(item.id)} activeOpacity={0.88}>
      <Card style={[styles.friendRow, selected && styles.friendRowSelected]}>
        <Avatar uri={item.avatar_url} fallback={displayName} size="md" />
        <View style={styles.friendInfo}>
          <Text style={styles.friendName} numberOfLines={1}>{displayName}</Text>
          {item.email && item.username ? <Text style={styles.friendEmail} numberOfLines={1}>{item.email}</Text> : null}
        </View>
        <View style={[styles.checkboxOuter, selected && styles.checkboxOuterSelected]}>
          {selected ? <Ionicons name="checkmark" size={16} color={colors.onAccent} /> : null}
        </View>
      </Card>
    </TouchableOpacity>
  );
});

export default function SnapSendScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const pendingUri = usePendingPhotoStore((s) => s.pendingPhotoUri);
  const galleryUri = usePendingPhotoStore((s) => s.pendingGalleryUri);
  const clearAll = usePendingPhotoStore((s) => s.clearAll);
  const photoSource = galleryUri ?? pendingUri;
  const hasLoadedOnceRef = useRef(false);

  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [addingToStory, setAddingToStory] = useState(false);
  const sendingRef = useRef(false);

  const loadFriends = useCallback(async () => {
    if (!userId) {
      startTransition(() => setFriends([]));
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const firstLoad = !hasLoadedOnceRef.current;
    if (firstLoad) setLoading(true);
    else setRefreshing(true);
    const { data } = await listFriends(userId);
    startTransition(() => setFriends(data ?? []));
    hasLoadedOnceRef.current = true;
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useEffect(() => { loadFriends(); }, [loadFriends]);

  if (!photoSource) {
    return (
      <View style={styles.container}>
        <PageHeader title="Choose recipients" />
        <EmptyState icon="image-outline" title="No photo available.">
          <AppButton label="Back to camera" onPress={() => router.replace('/')} icon="arrow-back-outline" />
        </EmptyState>
      </View>
    );
  }

  async function handleSend() {
    if (selectedIds.length === 0 || !userId || !photoSource || sendingRef.current || addingToStory) return;
    sendingRef.current = true;
    setSending(true);
    try {
      let imageBytes: Uint8Array;
      if (galleryUri) {
        imageBytes = await remoteUriToBytes(galleryUri);
      } else {
        const manipulated = await ImageManipulator.manipulateAsync(
          photoSource,
          [{ resize: { width: MAX_IMAGE_WIDTH } }],
          { compress: COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        if (manipulated.base64?.length) {
          imageBytes = base64ToUint8Array(manipulated.base64);
        } else {
          const b64 = await uriToBase64(manipulated.uri ?? photoSource);
          imageBytes = base64ToUint8Array(b64);
        }
      }
      const errors: string[] = [];
      for (const recipientId of selectedIds) {
        try {
          const snapId = await createSnapWithImage(userId, recipientId, imageBytes);
          try {
            const threadId = await getOrCreateThread(recipientId);
            await sendSnapMessage(threadId, snapId);
          } catch {
            // best-effort chat entry
          }
        } catch {
          const name = friends.find((f) => f.id === recipientId)?.username ?? recipientId.slice(0, 8);
          errors.push(name);
        }
      }
      if (errors.length > 0) {
        Alert.alert('Partial failure', `Could not send to: ${errors.join(', ')}`);
      }
      void trackEvent('snap_send_completed', {
        recipientsSelected: selectedIds.length,
        failedRecipients: errors.length,
        source: galleryUri ? 'gallery' : 'camera',
      });
      clearAll();
      router.replace('/');
    } catch (e) {
      void reportError('snap_send_failed', e, {
        recipientsSelected: selectedIds.length,
        source: galleryUri ? 'gallery' : 'camera',
      });
      Alert.alert('Error', e instanceof Error ? e.message : 'Send failed.', [{ text: 'OK' }]);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function handleAddToMyStory() {
    if (!photoSource || !userId || addingToStory || sending) return;
    setAddingToStory(true);
    try {
      await createStoryFromUri(userId, photoSource, 'image');
      void trackEvent('story_add_from_send', {
        source: galleryUri ? 'gallery' : 'camera',
      });
      Alert.alert('Added to My Story', 'Your story is now visible to friends for 24 hours.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not add to story.';
      void reportError('story_add_from_send_failed', e, {
        source: galleryUri ? 'gallery' : 'camera',
      });
      Alert.alert('Story failed', message);
    } finally {
      setAddingToStory(false);
    }
  }

  function handleCancel() {
    clearAll();
    router.replace('/');
  }

  function toggleRecipient(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <PageHeader
          title="Choose recipients"
          left={(
            <TouchableOpacity onPress={handleCancel} style={styles.headerIcon} activeOpacity={0.82}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
        />
        <Card style={styles.storyCard}>
          <Text style={styles.storyTitle}>My Story</Text>
          <Text style={styles.storySubtitle}>Post this snap to your story for 24 hours.</Text>
          <AppButton
            label="Add to My Story"
            onPress={handleAddToMyStory}
            loading={addingToStory}
            disabled={sending}
            icon="albums-outline"
          />
        </Card>
      </View>

      <FlatList<FriendListItem>
        data={friends}
        keyExtractor={(item: FriendListItem) => item.id}
        renderItem={({ item }: { item: FriendListItem }) => <RecipientRow item={item} selected={selectedIds.includes(item.id)} onToggle={toggleRecipient} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={8}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadFriends} tintColor={colors.accent} />}
        ListEmptyComponent={
          loading && !hasLoadedOnceRef.current ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : (
            <EmptyState icon="people-outline" title="No friends found." subtitle="Add friends first." />
          )
        }
        ListFooterComponent={<View style={styles.footerSpace} />}
      />

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <AppButton
          label={selectedIds.length === 0 ? 'Select friends' : `Send to ${selectedIds.length} friend${selectedIds.length !== 1 ? 's' : ''}`}
          onPress={handleSend}
          disabled={selectedIds.length === 0 || sending || addingToStory}
          loading={sending}
          icon="send"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  topSection: {
    paddingHorizontal: spacing.lg,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  storyCard: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  storyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  storySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 220 },
  friendTouchable: {
    marginBottom: spacing.sm,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  friendRowSelected: {
    borderColor: 'rgba(255,138,91,0.35)',
    backgroundColor: 'rgba(255,138,91,0.09)',
  },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  friendEmail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  checkboxOuter: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOuterSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.bgCardBorder,
    backgroundColor: colors.surface,
  },
  footerSpace: {
    height: 30,
  },
});
