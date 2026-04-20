import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useAuthStore } from '@/store/useAuthStore';
import { listThreadsWithPreview, type ThreadWithPreview } from '@/lib/chat';
import {
  getFriendshipStreaks,
  listBestFriendIds,
  listFriendStories,
  listGroupThreadsWithPreview,
  type GroupThreadWithPreview,
  type StoryItem,
} from '@/lib/socialFeatures';
import { Avatar } from '@/ui/components/Avatar';
import { EmptyState } from '@/ui/components/EmptyState';
import { PageHeader } from '@/ui/components/PageHeader';
import { Card } from '@/ui/components/Card';
import { colors, radius, spacing } from '@/ui/theme';

const PREVIEW_LEN = 48;
const MAX_PINNED_CHATS = 3;
const FOCUS_REFRESH_COOLDOWN_MS = 2500;

type StoryStripItem = {
  userId: string;
  storyId: string;
  username: string | null;
  avatarUrl: string | null;
  hasUnviewed: boolean;
  latestAt: string;
};

type DirectInboxRow = {
  kind: 'direct';
  key: string;
  thread: ThreadWithPreview;
  pinned: boolean;
  streakDays: number;
  sortTs: number;
};

type GroupInboxRow = {
  kind: 'group';
  key: string;
  group: GroupThreadWithPreview;
  sortTs: number;
};

type InboxRow = DirectInboxRow | GroupInboxRow;

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

function buildStoryStripItems(stories: StoryItem[]): StoryStripItem[] {
  const byUser = new Map<string, StoryItem[]>();
  for (const story of stories) {
    const prev = byUser.get(story.user_id) ?? [];
    prev.push(story);
    byUser.set(story.user_id, prev);
  }

  return Array.from(byUser.entries())
    .map(([userId, userStories]) => {
      const sorted = [...userStories].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const latest = sorted[sorted.length - 1];
      return {
        userId,
        storyId: latest?.id ?? '',
        username: latest?.profile_username ?? null,
        avatarUrl: latest?.profile_avatar_url ?? null,
        hasUnviewed: sorted.some((item) => !item.viewed_by_me),
        latestAt: latest?.created_at ?? '',
      };
    })
    .filter((item) => !!item.storyId)
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
}

const DirectThreadRow = memo(function DirectThreadRow({
  row,
  onPress,
}: {
  row: DirectInboxRow;
  onPress: (id: string) => void;
}) {
  const item = row.thread;
  const unreadPulse = useSharedValue(0);
  const basePreview = item.previewText ?? '';
  const preview = basePreview.length <= PREVIEW_LEN ? basePreview : `${basePreview.slice(0, PREVIEW_LEN).trim()}...`;
  const idFallback = (item.otherUserId ?? '').slice(0, 8) || 'Unknown';
  const displayName = item.otherUsername ?? `${idFallback}...`;
  const lastAtIso = item.lastAt ?? '';
  const timeLabel = lastAtIso ? formatTime(lastAtIso) : '';

  useEffect(() => {
    if (!item.hasUnread) {
      cancelAnimation(unreadPulse);
      unreadPulse.value = withTiming(0, { duration: 120 });
      return;
    }
    unreadPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 650, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(unreadPulse);
    };
  }, [item.hasUnread, unreadPulse]);

  const rowPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: item.hasUnread ? interpolate(unreadPulse.value, [0, 1], [1, 1.012]) : 1 }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: item.hasUnread ? interpolate(unreadPulse.value, [0, 1], [0.22, 0.55]) : 0,
  }));

  const avatarRingStyle = useAnimatedStyle(() => ({
    opacity: item.hasUnread ? interpolate(unreadPulse.value, [0, 1], [0.3, 0.8]) : 0,
    transform: [{ scale: item.hasUnread ? interpolate(unreadPulse.value, [0, 1], [1, 1.08]) : 1 }],
  }));

  const unreadDotStyle = useAnimatedStyle(() => ({
    opacity: item.hasUnread ? interpolate(unreadPulse.value, [0, 1], [0.65, 1]) : 1,
    transform: [{ scale: item.hasUnread ? interpolate(unreadPulse.value, [0, 1], [0.92, 1.2]) : 1 }],
  }));

  return (
    <TouchableOpacity style={styles.rowTouchable} onPress={() => onPress(item.otherUserId)} activeOpacity={0.88}>
      <View style={styles.unreadRowWrap}>
        {item.hasUnread ? <Animated.View pointerEvents="none" style={[styles.chatRowUnreadGlow, glowStyle]} /> : null}
        <Animated.View style={item.hasUnread ? rowPulseStyle : undefined}>
          <Card style={[styles.chatRow, item.hasUnread && styles.chatRowUnread]}>
            <View style={styles.avatarWrap}>
              <Avatar uri={item.otherAvatarUrl} fallback={displayName} size="ml" />
              {item.hasUnread ? <Animated.View pointerEvents="none" style={[styles.avatarUnreadRing, avatarRingStyle]} /> : null}
            </View>
            <View style={styles.rowText}>
              <View style={styles.rowTitleLine}>
                <Text style={styles.rowName} numberOfLines={1}>{displayName}</Text>
                {row.streakDays > 0 ? <Text style={styles.rowStreak}>{`${'\u{1F525}'} ${row.streakDays}`}</Text> : null}
                {item.hasUnread ? (
                  <View style={styles.unreadBadgeWrap}>
                    <Animated.View style={[styles.unreadDot, unreadDotStyle]} />
                    <Text style={styles.unreadBadgeText}>NEW</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.rowPreview} numberOfLines={1}>{preview || 'No messages yet'}</Text>
            </View>
            <View style={styles.rowRightCol}>
              {row.pinned ? <Text style={styles.pinLabel}>Pinned</Text> : null}
              <Text style={styles.rowTime}>{timeLabel}</Text>
            </View>
          </Card>
        </Animated.View>
      </View>
    </TouchableOpacity>
  );
});

const GroupThreadRow = memo(function GroupThreadRow({
  row,
  onPress,
}: {
  row: GroupInboxRow;
  onPress: (id: string) => void;
}) {
  const group = row.group;
  const previewText = group.last_message_body?.trim() || 'No messages yet';
  const preview = previewText.length <= PREVIEW_LEN ? previewText : `${previewText.slice(0, PREVIEW_LEN).trim()}...`;
  const timeSource = group.last_message_at ?? group.created_at;
  const timeLabel = timeSource ? formatTime(timeSource) : '';

  return (
    <TouchableOpacity style={styles.rowTouchable} onPress={() => onPress(group.id)} activeOpacity={0.88}>
      <Card style={styles.chatRowGroup}>
        <Avatar uri={group.avatar_url} fallback={group.title} size="ml" />
        <View style={styles.rowText}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowName} numberOfLines={1}>{group.title}</Text>
            <Text style={styles.groupBadge}>Group</Text>
          </View>
          <Text style={styles.rowPreview} numberOfLines={1}>{preview}</Text>
        </View>
        <View style={styles.rowRightCol}>
          <Text style={styles.groupMemberMeta}>{group.member_count} member(s)</Text>
          <Text style={styles.rowTime}>{timeLabel}</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
});

export default function InboxScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id) ?? null;

  const [rows, setRows] = useState<InboxRow[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const requestRef = useRef(0);

  const loadChats = useCallback(async (options?: { force?: boolean }) => {
    if (!userId) {
      startTransition(() => {
        setRows([]);
        setStories([]);
      });
      setInitialLoading(false);
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
    if (firstLoad) setInitialLoading(true);
    else setRefreshing(true);

    try {
      const [threadResult, storyResult, streakResult, bestFriendIds, groupResult] = await Promise.all([
        listThreadsWithPreview(userId),
        listFriendStories().catch(() => [] as StoryItem[]),
        getFriendshipStreaks(200).catch(() => []),
        listBestFriendIds(userId).catch(() => [] as string[]),
        listGroupThreadsWithPreview().catch(() => [] as GroupThreadWithPreview[]),
      ]);

      const pinnedIds = bestFriendIds.slice(0, MAX_PINNED_CHATS);
      const pinnedOrder = new Map<string, number>(pinnedIds.map((id, index) => [id, index]));
      const streakMap = Object.fromEntries(
        streakResult.map((entry) => [entry.friend_id, entry.streak_days]),
      ) as Record<string, number>;

      const directRows: DirectInboxRow[] = threadResult.map((thread) => ({
        kind: 'direct',
        key: `direct-${thread.threadId}`,
        thread,
        pinned: pinnedOrder.has(thread.otherUserId),
        streakDays: streakMap[thread.otherUserId] ?? 0,
        sortTs: new Date(thread.lastAt).getTime(),
      }));

      const pinnedDirectRows = directRows
        .filter((row) => row.pinned)
        .sort((a, b) => {
          const aRank = pinnedOrder.get(a.thread.otherUserId) ?? 99;
          const bRank = pinnedOrder.get(b.thread.otherUserId) ?? 99;
          return aRank - bRank;
        });

      const nonPinnedDirectRows = directRows
        .filter((row) => !row.pinned)
        .sort((a, b) => b.sortTs - a.sortTs);

      const groupRows: GroupInboxRow[] = groupResult.map((group) => ({
        kind: 'group',
        key: `group-${group.id}`,
        group,
        sortTs: new Date(group.last_message_at ?? group.created_at).getTime(),
      }));

      const mixedRows = [...nonPinnedDirectRows, ...groupRows].sort((a, b) => b.sortTs - a.sortTs);
      const orderedRows: InboxRow[] = [...pinnedDirectRows, ...mixedRows];

      if (isStale()) return;
      startTransition(() => {
        setRows(orderedRows);
        setStories(storyResult);
      });
      hasLoadedOnceRef.current = true;
      lastLoadedAtRef.current = Date.now();
    } catch {
      if (!hasLoadedOnceRef.current && !isStale()) startTransition(() => setRows([]));
    } finally {
      if (!isStale()) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { loadChats(); }, [loadChats]));

  const openDirectThread = useCallback((otherUserId: string) => {
    router.push(`/(tabs)/inbox/chat/${otherUserId}`);
  }, [router]);

  const openGroupThread = useCallback((groupId: string) => {
    router.push(`/(tabs)/inbox/group/${groupId}`);
  }, [router]);
  const storyStripItems = useMemo(() => buildStoryStripItems(stories), [stories]);

  if (!userId) {
    return (
      <View style={styles.container}>
        <PageHeader title="Inbox" />
        <EmptyState icon="log-in-outline" title="Not signed in" />
      </View>
    );
  }

  const showInitialSpinner = initialLoading && !hasLoadedOnceRef.current && rows.length === 0;

  return (
    <View style={styles.container}>
      <FlatList<InboxRow>
        data={rows}
        keyExtractor={(item: InboxRow) => item.key}
        renderItem={({ item }: { item: InboxRow }) => (
          item.kind === 'direct'
            ? <DirectThreadRow row={item} onPress={openDirectThread} />
            : <GroupThreadRow row={item} onPress={openGroupThread} />
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={8}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadChats({ force: true })} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View>
            <PageHeader title="Inbox" />
            {storyStripItems.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.storyStrip}
              >
                {storyStripItems.map((storyItem) => {
                  const displayName = storyItem.username ?? storyItem.userId.slice(0, 6);
                  return (
                    <TouchableOpacity
                      key={storyItem.userId}
                      style={styles.storyItem}
                      activeOpacity={0.82}
                      onPress={() => router.push(`/story/${storyItem.userId}`)}
                    >
                      <View style={[styles.storyAvatarWrap, !storyItem.hasUnviewed && styles.storyAvatarWrapViewed]}>
                        <Avatar
                          uri={storyItem.avatarUrl}
                          fallback={displayName}
                          size="md"
                        />
                      </View>
                      <Text style={styles.storyName} numberOfLines={1}>
                        {displayName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>
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
  storyStrip: {
    paddingBottom: spacing.md,
    paddingHorizontal: 2,
    gap: 12,
  },
  storyItem: {
    width: 68,
    alignItems: 'center',
  },
  storyAvatarWrap: {
    padding: 2,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.accent,
    marginBottom: 6,
  },
  storyAvatarWrapViewed: {
    borderColor: colors.bgCardBorder,
    opacity: 0.75,
  },
  storyName: {
    fontSize: 11,
    color: colors.textMuted,
    width: 64,
    textAlign: 'center',
  },
  loadingWrap: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  rowTouchable: {
    marginBottom: spacing.sm,
  },
  unreadRowWrap: {
    position: 'relative',
  },
  chatRowUnreadGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.lg + 2,
    borderWidth: 1.5,
    borderColor: 'rgba(125,211,252,0.95)',
    backgroundColor: 'rgba(125,211,252,0.08)',
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
  },
  chatRowUnread: {
    borderColor: 'rgba(125,211,252,0.45)',
    backgroundColor: 'rgba(125,211,252,0.14)',
  },
  chatRowGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
    borderColor: 'rgba(148,163,184,0.22)',
    backgroundColor: 'rgba(11,23,40,0.86)',
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarUnreadRing: {
    position: 'absolute',
    top: -3,
    right: -3,
    bottom: -3,
    left: -3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(125,211,252,0.95)',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  rowName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    maxWidth: '62%',
  },
  rowStreak: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  unreadBadgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    height: 20,
    borderRadius: 999,
    backgroundColor: 'rgba(125,211,252,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.4)',
  },
  groupBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.accentSecondary,
    backgroundColor: 'rgba(125,211,252,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.28)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.accentSecondary,
  },
  unreadBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.accentSecondary,
    letterSpacing: 0.2,
  },
  rowPreview: {
    fontSize: 14,
    color: colors.textMuted,
  },
  rowRightCol: {
    alignItems: 'flex-end',
    minWidth: 70,
  },
  pinLabel: {
    fontSize: 10,
    color: colors.accentSecondary,
    fontWeight: '700',
    marginBottom: 2,
  },
  groupMemberMeta: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '700',
    marginBottom: 2,
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
