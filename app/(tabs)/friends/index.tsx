import { memo, startTransition, useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  type GestureResponderEvent,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/useAuthStore';
import { useFriendRequestsStore } from '@/store/useFriendRequestsStore';
import { listFriends } from '@/lib/friendRequests';
import { getOrCreateThread } from '@/lib/chat';
import { Avatar } from '@/ui/components/Avatar';
import { AppButton } from '@/ui/components/AppButton';
import { EmptyState } from '@/ui/components/EmptyState';
import { PageHeader } from '@/ui/components/PageHeader';
import { Card } from '@/ui/components/Card';
import { colors, radius, spacing } from '@/ui/theme';

type Friend = { id: string; username: string | null; email: string | null; avatar_url: string | null };

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

export default function FriendsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const pendingIncomingCount = useFriendRequestsStore((s) => s.pendingIncomingCount);
  const refreshPendingIncoming = useFriendRequestsStore((s) => s.refreshPendingIncoming);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chatLoading, setChatLoading] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

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
    startTransition(() => setFriends((data as Friend[] | null) ?? []));
    hasLoadedOnceRef.current = true;
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      refreshPendingIncoming();
      loadFriends();
    }, [refreshPendingIncoming, loadFriends]),
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
        label="Discover people"
        onPress={() => router.push('/friends/discover')}
        icon="person-add-outline"
        style={styles.discoverButton}
      />
    </View>
  ), [pendingIncomingCount, router]);

  return (
    <View style={styles.container}>
      <FlatList<Friend>
        data={friends}
        keyExtractor={(item: Friend) => item.id}
        renderItem={({ item }: { item: Friend }) => (
          <FriendRow
            item={item}
            chatLoading={chatLoading === item.id}
            onOpenDetail={(id: string) => router.push(`/(tabs)/friends/detail/${id}`)}
            onOpenChat={openChat}
          />
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={8}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadFriends} tintColor={colors.accent} />}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          loading && !hasLoadedOnceRef.current ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            <EmptyState icon="people-outline" title="No friends yet." subtitle="Search for people to start your first private circle.">
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
    paddingVertical: spacing.xxl,
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
  discoverButton: {
    marginBottom: spacing.lg,
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
  emptyAction: {
    marginTop: spacing.sm,
  },
  footerSpace: {
    height: 30,
  },
});
