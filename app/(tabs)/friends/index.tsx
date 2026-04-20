import { memo, startTransition, useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/useAuthStore';
import { useFriendRequestsStore } from '@/store/useFriendRequestsStore';
import { listFriends } from '@/lib/friendRequests';
import { getOrCreateThread } from '@/lib/chat';
import { listMyGroupThreads, type GroupThreadItem } from '@/lib/socialFeatures';
import { AppButton } from '@/ui/components/AppButton';
import { Avatar } from '@/ui/components/Avatar';
import { Card } from '@/ui/components/Card';
import { EmptyState } from '@/ui/components/EmptyState';
import { PageHeader } from '@/ui/components/PageHeader';
import { colors, radius, spacing } from '@/ui/theme';

type Friend = { id: string; username: string | null; email: string | null; avatar_url: string | null };

type FriendsListItem =
  | { kind: 'section'; id: string; title: string }
  | { kind: 'friend'; id: string; friend: Friend }
  | { kind: 'group'; id: string; group: GroupThreadItem };

const FriendRow = memo(function FriendRow({
  item,
  chatLoading,
  onOpenDetail,
  onOpenChat,
}: {
  item: Friend;
  chatLoading: boolean;
  onOpenDetail: (id: string) => void;
  onOpenChat: (id: string) => void;
}) {
  const displayName = item.username ?? item.email ?? `${item.id.slice(0, 8)}...`;

  return (
    <TouchableOpacity style={styles.friendTouchable} onPress={() => onOpenDetail(item.id)} activeOpacity={0.88}>
      <Card style={styles.friendRow}>
        <Avatar uri={item.avatar_url} fallback={displayName} size="md" />
        <View style={styles.friendCopy}>
          <Text style={styles.friendName} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.friendMeta} numberOfLines={1}>{item.email ?? 'Tap for profile and stats'}</Text>
        </View>
        <TouchableOpacity
          style={styles.chatButton}
          onPress={(event: GestureResponderEvent) => {
            event.stopPropagation?.();
            onOpenChat(item.id);
          }}
          disabled={chatLoading}
          activeOpacity={0.8}
        >
          {chatLoading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accentSecondary} />
          )}
        </TouchableOpacity>
      </Card>
    </TouchableOpacity>
  );
});

const GroupRow = memo(function GroupRow({
  item,
  onOpenGroup,
}: {
  item: GroupThreadItem;
  onOpenGroup: (id: string) => void;
}) {
  return (
    <TouchableOpacity style={styles.friendTouchable} onPress={() => onOpenGroup(item.id)} activeOpacity={0.88}>
      <Card style={styles.friendRow}>
        <Avatar uri={item.avatar_url} fallback={item.title} size="md" />
        <View style={styles.friendCopy}>
          <Text style={styles.friendName} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.friendMeta} numberOfLines={1}>Group chat</Text>
        </View>
        <View style={styles.groupIconWrap}>
          <Ionicons name="people-outline" size={20} color={colors.accentSecondary} />
        </View>
      </Card>
    </TouchableOpacity>
  );
});

function buildListItems(groups: GroupThreadItem[], friends: Friend[]): FriendsListItem[] {
  const rows: FriendsListItem[] = [];

  if (groups.length > 0) {
    rows.push({ kind: 'section', id: 'section-groups', title: 'Groups' });
    for (const group of groups) rows.push({ kind: 'group', id: `group-${group.id}`, group });
  }

  if (friends.length > 0) {
    rows.push({ kind: 'section', id: 'section-friends', title: 'Friends' });
    for (const friend of friends) rows.push({ kind: 'friend', id: `friend-${friend.id}`, friend });
  }

  return rows;
}

const FOCUS_REFRESH_COOLDOWN_MS = 3000;

export default function FriendsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const pendingIncomingCount = useFriendRequestsStore((s) => s.pendingIncomingCount);
  const refreshPendingIncoming = useFriendRequestsStore((s) => s.refreshPendingIncoming);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<GroupThreadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chatLoading, setChatLoading] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const requestRef = useRef(0);

  const listItems = useMemo(() => buildListItems(groups, friends), [friends, groups]);

  const loadFriendsAndGroups = useCallback(async (options?: { force?: boolean }) => {
    if (!userId) {
      startTransition(() => {
        setFriends([]);
        setGroups([]);
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

    try {
      const [friendsResult, groupResult] = await Promise.all([
        listFriends(userId),
        listMyGroupThreads().catch(() => [] as GroupThreadItem[]),
      ]);

      if (isStale()) return;
      startTransition(() => {
        setFriends((friendsResult.data as Friend[] | null) ?? []);
        setGroups(groupResult);
      });

      hasLoadedOnceRef.current = true;
      lastLoadedAtRef.current = Date.now();
    } catch {
      if (!isStale()) {
        startTransition(() => {
          setFriends([]);
          setGroups([]);
        });
      }
    } finally {
      if (!isStale()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      refreshPendingIncoming();
      loadFriendsAndGroups();
    }, [refreshPendingIncoming, loadFriendsAndGroups]),
  );

  const openChat = useCallback(async (friendId: string) => {
    if (chatLoading) return;
    setChatLoading(friendId);
    try {
      await getOrCreateThread(friendId);
      router.push(`/(tabs)/inbox/chat/${friendId}`);
    } catch {
      // ignore
    } finally {
      setChatLoading(null);
    }
  }, [chatLoading, router]);

  const openGroup = useCallback((groupId: string) => {
    router.push(`/(tabs)/inbox/group/${groupId}`);
  }, [router]);

  const renderHeader = useCallback(() => (
    <View>
      <PageHeader
        title="Friends"
        right={(
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => router.push('/friends/requests')}
              activeOpacity={0.85}
            >
              <Ionicons name="mail-outline" size={20} color={colors.textPrimary} />
              {pendingIncomingCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{pendingIncomingCount > 99 ? '99+' : pendingIncomingCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
        )}
      />
      <AppButton
        label="Search friends"
        onPress={() => router.push('/friends/search')}
        icon="search-outline"
        style={styles.actionButton}
      />
      <AppButton
        label="Create group"
        onPress={() => router.push('/friends/groups/create')}
        icon="people-outline"
        variant="secondary"
        style={styles.groupButton}
      />
      <AppButton
        label="Discover people"
        onPress={() => router.push('/friends/discover')}
        icon="person-add-outline"
        variant="secondary"
        style={styles.discoverButton}
      />
    </View>
  ), [pendingIncomingCount, router]);

  return (
    <View style={styles.container}>
      <FlatList<FriendsListItem>
        data={listItems}
        keyExtractor={(item: FriendsListItem) => item.id}
        renderItem={({ item }: { item: FriendsListItem }) => {
          if (item.kind === 'section') {
            return <Text style={styles.sectionTitle}>{item.title}</Text>;
          }
          if (item.kind === 'group') {
            return <GroupRow item={item.group} onOpenGroup={openGroup} />;
          }
          return (
            <FriendRow
              item={item.friend}
              chatLoading={chatLoading === item.friend.id}
              onOpenDetail={(id: string) => router.push(`/(tabs)/friends/detail/${id}`)}
              onOpenChat={openChat}
            />
          );
        }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={8}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFriendsAndGroups({ force: true })} tintColor={colors.accent} />}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          loading && !hasLoadedOnceRef.current ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            <EmptyState icon="people-outline" title="No friends or groups yet." subtitle="Search for people or create a group to start your circle.">
              <AppButton label="Search friends" onPress={() => router.push('/friends/search')} icon="search-outline" style={styles.emptyAction} />
            </EmptyState>
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
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.onAccent,
  },
  actionButton: {
    marginBottom: spacing.sm,
  },
  groupButton: {
    marginBottom: spacing.sm,
  },
  discoverButton: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  friendTouchable: {
    marginBottom: spacing.sm,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  friendCopy: {
    flex: 1,
    minWidth: 0,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  friendMeta: {
    fontSize: 13,
    color: colors.textMuted,
  },
  chatButton: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(125,211,252,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.24)',
  },
  groupIconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(125,211,252,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.24)',
  },
  emptyAction: {
    marginTop: spacing.sm,
  },
  footerSpace: {
    height: 30,
  },
});
