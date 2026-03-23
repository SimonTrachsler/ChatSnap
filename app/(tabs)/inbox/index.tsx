import { memo, startTransition, useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '@/store/useAuthStore';
import { listThreadsWithPreview, type ThreadWithPreview } from '@/lib/chat';
import { Avatar } from '@/ui/components/Avatar';
import { EmptyState } from '@/ui/components/EmptyState';
import { PageHeader } from '@/ui/components/PageHeader';
import { Card } from '@/ui/components/Card';
import { colors, radius, spacing } from '@/ui/theme';

const PREVIEW_LEN = 48;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' });
}

const ThreadRow = memo(function ThreadRow({ item, onPress }: { item: ThreadWithPreview; onPress: (id: string) => void }) {
  const basePreview = item.previewText ?? '';
  const preview = basePreview.length <= PREVIEW_LEN ? basePreview : `${basePreview.slice(0, PREVIEW_LEN).trim()}...`;
  const idFallback = (item.otherUserId ?? '').slice(0, 8) || 'Unknown';
  const displayName = item.otherUsername ?? `${idFallback}...`;
  const lastAtIso = item.lastAt ?? '';
  const timeLabel = lastAtIso ? formatTime(lastAtIso) : '';

  return (
    <TouchableOpacity style={styles.rowTouchable} onPress={() => onPress(item.otherUserId)} activeOpacity={0.88}>
      <Card style={[styles.chatRow, item.hasUnread && styles.chatRowUnread]}>
        <Avatar uri={item.otherAvatarUrl} fallback={displayName} size="ml" />
        <View style={styles.rowText}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowName} numberOfLines={1}>{displayName}</Text>
            {item.hasUnread ? <View style={styles.unreadDot} /> : null}
          </View>
          <Text style={styles.rowPreview} numberOfLines={1}>{preview || 'No messages yet'}</Text>
        </View>
        <Text style={styles.rowTime}>{timeLabel}</Text>
      </Card>
    </TouchableOpacity>
  );
});

export default function InboxScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const [threads, setThreads] = useState<ThreadWithPreview[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const loadChats = useCallback(async () => {
    if (!userId) {
      startTransition(() => setThreads([]));
      setInitialLoading(false);
      setRefreshing(false);
      return;
    }
    const firstLoad = !hasLoadedOnceRef.current;
    if (firstLoad) setInitialLoading(true);
    else setRefreshing(true);
    try {
      const result = await listThreadsWithPreview(userId);
      startTransition(() => setThreads(result));
      hasLoadedOnceRef.current = true;
    } catch {
      if (!hasLoadedOnceRef.current) startTransition(() => setThreads([]));
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { loadChats(); }, [loadChats]));

  const openThread = useCallback((otherUserId: string) => {
    router.push(`/(tabs)/inbox/chat/${otherUserId}`);
  }, [router]);

  if (!userId) {
    return (
      <View style={styles.container}>
        <PageHeader title="Inbox" />
        <EmptyState icon="log-in-outline" title="Not signed in" />
      </View>
    );
  }

  const showInitialSpinner = initialLoading && !hasLoadedOnceRef.current && threads.length === 0;

  return (
    <View style={styles.container}>
      <FlatList<ThreadWithPreview>
        data={threads}
        keyExtractor={(item: ThreadWithPreview) => item.threadId}
        renderItem={({ item }: { item: ThreadWithPreview }) => <ThreadRow item={item} onPress={openThread} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={8}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadChats} tintColor={colors.accent} />}
        ListHeaderComponent={
          <PageHeader title="Inbox" />
        }
        ListEmptyComponent={
          showInitialSpinner ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            <EmptyState icon="chatbubble-ellipses-outline" title="No conversations yet." subtitle="Send a snap or start a chat with a friend." />
          )
        }
        ListFooterComponent={<View style={styles.footerSpace} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 140,
  },
  loadingWrap: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  rowTouchable: {
    marginBottom: spacing.sm,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
  },
  chatRowUnread: {
    borderColor: 'rgba(255,138,91,0.28)',
    backgroundColor: 'rgba(255,138,91,0.08)',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  rowName: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginLeft: spacing.sm,
  },
  rowPreview: {
    fontSize: 14,
    color: colors.textMuted,
  },
  rowTime: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  footerSpace: {
    height: 30,
  },
});
