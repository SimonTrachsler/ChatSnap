import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { listFriends, type FriendListItem } from '@/lib/friendRequests';
import {
  addGroupThreadMember,
  getGroupThreadById,
  listGroupMessages,
  listGroupThreadMembers,
  removeGroupThreadMember,
  sendGroupMessage,
  type GroupMessageItem,
  type GroupThreadItem,
  type GroupThreadMemberItem,
} from '@/lib/socialFeatures';
import { supabase } from '@/lib/supabase';
import { supabaseErrorToUserMessage } from '@/lib/supabaseErrors';
import { useAuthStore } from '@/store/useAuthStore';
import { Avatar } from '@/ui/components/Avatar';
import { colors, radius, spacing } from '@/ui/theme';
import { getFloatingTabBarMetrics } from '@/ui/tabBar';

type GroupChatScreenProps = {
  backHref: '/(tabs)/inbox' | '/(tabs)/friends';
};

type MemberTone = {
  bubble: string;
  border: string;
  label: string;
};

const MEMBER_TONES: MemberTone[] = [
  { bubble: 'rgba(125,211,252,0.16)', border: 'rgba(125,211,252,0.38)', label: '#A9E3FF' },
  { bubble: 'rgba(165,180,252,0.16)', border: 'rgba(165,180,252,0.38)', label: '#C7D2FE' },
  { bubble: 'rgba(110,231,183,0.16)', border: 'rgba(110,231,183,0.34)', label: '#A7F3D0' },
  { bubble: 'rgba(251,191,36,0.14)', border: 'rgba(251,191,36,0.34)', label: '#FCD34D' },
  { bubble: 'rgba(244,114,182,0.16)', border: 'rgba(244,114,182,0.34)', label: '#F9A8D4' },
  { bubble: 'rgba(196,181,253,0.16)', border: 'rgba(196,181,253,0.34)', label: '#DDD6FE' },
  { bubble: 'rgba(74,222,128,0.14)', border: 'rgba(74,222,128,0.32)', label: '#86EFAC' },
  { bubble: 'rgba(248,113,113,0.14)', border: 'rgba(248,113,113,0.32)', label: '#FCA5A5' },
];
const GROUP_MESSAGES_SYNC_FALLBACK_MS = 4_000;

function normalizeGroupIdParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return null;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function getKeyboardInsetFromBottom(event: unknown): number {
  const end = (event as { endCoordinates?: { height?: number; screenY?: number } } | undefined)?.endCoordinates;
  if (typeof end?.screenY === 'number' && Number.isFinite(end.screenY)) {
    return Math.max(0, Dimensions.get('window').height - end.screenY);
  }
  if (typeof end?.height === 'number' && Number.isFinite(end.height)) {
    return Math.max(0, end.height);
  }
  const metrics = (Keyboard as unknown as { metrics?: () => { height?: number } | undefined }).metrics?.();
  return typeof metrics?.height === 'number' && Number.isFinite(metrics.height) ? Math.max(0, metrics.height) : 0;
}

function toneForUserId(userId: string): MemberTone {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % MEMBER_TONES.length;
  return MEMBER_TONES[index];
}

function displayMemberName(member: { username?: string | null; user_id?: string; id?: string }): string {
  if (member.username?.trim()) return member.username.trim();
  const id = member.user_id ?? member.id ?? '';
  return id ? `${id.slice(0, 8)}...` : 'Member';
}

export function GroupChatScreen({ backHref }: GroupChatScreenProps) {
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = normalizeGroupIdParam(params.groupId);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarMetrics = getFloatingTabBarMetrics(insets);
  const myId = useAuthStore((s) => s.user?.id) ?? null;

  const [group, setGroup] = useState<GroupThreadItem | null>(null);
  const [members, setMembers] = useState<GroupThreadMemberItem[]>([]);
  const [messages, setMessages] = useState<GroupMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [membersVisible, setMembersVisible] = useState(false);
  const [addMembersVisible, setAddMembersVisible] = useState(false);
  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [memberActionUserId, setMemberActionUserId] = useState<string | null>(null);

  const listRef = useRef<{ scrollToEnd: (options?: { animated?: boolean }) => void } | null>(null);

  const memberById = useMemo(() => {
    const map = new Map<string, GroupThreadMemberItem>();
    for (const member of members) map.set(member.user_id, member);
    return map;
  }, [members]);

  const myRole = useMemo(() => members.find((member) => member.user_id === myId)?.role ?? null, [members, myId]);
  const canManageMembers = myRole === 'owner' || myRole === 'admin';

  const memberIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const member of members) set.add(member.user_id);
    return set;
  }, [members]);

  const addableFriends = useMemo(
    () => friends.filter((friend) => !memberIdSet.has(friend.id)),
    [friends, memberIdSet],
  );

  const refreshMembers = useCallback(async () => {
    if (!groupId) return;
    const nextMembers = await listGroupThreadMembers(groupId);
    setMembers(nextMembers);
  }, [groupId]);

  const refreshMessages = useCallback(async () => {
    if (!groupId) return;
    const nextMessages = await listGroupMessages(groupId);
    setMessages(nextMessages);
  }, [groupId]);

  const loadData = useCallback(async () => {
    if (!groupId) {
      setScreenError('Group not found.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setScreenError(null);
    setSendError(null);

    try {
      const thread = await getGroupThreadById(groupId);

      if (!thread) {
        setGroup(null);
        setMembers([]);
        setMessages([]);
        setScreenError('Group not found or no access.');
        return;
      }

      const [threadMembersResult, threadMessagesResult] = await Promise.allSettled([
        listGroupThreadMembers(groupId),
        listGroupMessages(groupId),
      ]);

      setGroup(thread);

      if (threadMembersResult.status === 'fulfilled') {
        setMembers(threadMembersResult.value);
      } else {
        setMembers([]);
        setSendError(supabaseErrorToUserMessage(threadMembersResult.reason));
      }

      if (threadMessagesResult.status === 'fulfilled') {
        setMessages(threadMessagesResult.value);
      } else {
        setMessages([]);
        setSendError(supabaseErrorToUserMessage(threadMessagesResult.reason));
      }
    } catch (error) {
      setScreenError(supabaseErrorToUserMessage(error));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!groupId) return;

    const channel = supabase
      .channel(`group_thread_${groupId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `thread_id=eq.${groupId}` },
        (payload) => {
          const row = payload.new as Partial<GroupMessageItem> & { id?: string; created_at?: string };
          const rowId = typeof row?.id === 'string' ? row.id : null;
          if (!rowId) {
            void refreshMessages();
            return;
          }
          setMessages((prev) => {
            if (prev.some((message) => message.id === rowId)) return prev;
            const next: GroupMessageItem[] = [
              ...prev,
              {
                id: rowId,
                thread_id: row.thread_id ?? groupId,
                sender_id: row.sender_id ?? '',
                body: row.body ?? '',
                message_type: row.message_type ?? 'text',
                media_path: row.media_path ?? null,
                metadata:
                  row.metadata && typeof row.metadata === 'object'
                    ? row.metadata as Record<string, unknown>
                    : {},
                created_at: row.created_at ?? new Date().toISOString(),
                sender_username: null,
                sender_avatar_url: null,
              },
            ];
            next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            return next;
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'group_messages', filter: `thread_id=eq.${groupId}` },
        () => {
          void refreshMessages();
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'group_messages', filter: `thread_id=eq.${groupId}` },
        () => {
          void refreshMessages();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_thread_members', filter: `thread_id=eq.${groupId}` },
        () => {
          void refreshMembers();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, refreshMembers, refreshMessages]);

  useEffect(() => {
    if (!groupId) return;
    const timer = setInterval(() => {
      void refreshMessages();
    }, GROUP_MESSAGES_SYNC_FALLBACK_MS);
    return () => clearInterval(timer);
  }, [groupId, refreshMessages]);

  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 90);
    return () => clearTimeout(timer);
  }, [messages.length]);

  useEffect(() => {
    const setVisibleHeightFromEvent = (event: unknown) => {
      setKeyboardHeight(getKeyboardInsetFromBottom(event));
    };

    if (Platform.OS === 'ios') {
      const show = Keyboard.addListener(
        'keyboardWillChangeFrame',
        ((event: unknown) => setVisibleHeightFromEvent(event)) as unknown as () => void,
      );
      const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
      return () => {
        show.remove();
        hide.remove();
      };
    }

    const show = Keyboard.addListener(
      'keyboardDidShow',
      ((event: unknown) => setVisibleHeightFromEvent(event)) as unknown as () => void,
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const loadFriends = useCallback(async () => {
    if (!myId) {
      setFriends([]);
      return;
    }
    setFriendsLoading(true);
    try {
      const { data } = await listFriends(myId);
      setFriends((data as FriendListItem[] | null) ?? []);
    } catch {
      setFriends([]);
    } finally {
      setFriendsLoading(false);
    }
  }, [myId]);

  useEffect(() => {
    if (!addMembersVisible) return;
    void loadFriends();
  }, [addMembersVisible, loadFriends]);

  const sendText = useCallback(async () => {
    if (!groupId || sending) return;
    const body = input.trim();
    if (!body) return;

    setSending(true);
    setSendError(null);
    try {
      await sendGroupMessage(groupId, body);
      setInput('');
      await refreshMessages();
    } catch (error) {
      setSendError(supabaseErrorToUserMessage(error));
    } finally {
      setSending(false);
    }
  }, [groupId, input, refreshMessages, sending]);

  const addMember = useCallback(async (userId: string) => {
    if (!groupId || !canManageMembers || memberActionUserId) return;
    setMemberActionUserId(userId);
    try {
      await addGroupThreadMember(groupId, userId);
      await refreshMembers();
    } catch (error) {
      Alert.alert('Error', supabaseErrorToUserMessage(error));
    } finally {
      setMemberActionUserId(null);
    }
  }, [canManageMembers, groupId, memberActionUserId, refreshMembers]);

  const removeMember = useCallback((user: GroupThreadMemberItem) => {
    if (!groupId || !canManageMembers || memberActionUserId) return;
    const label = displayMemberName(user);
    Alert.alert(
      'Remove member',
      `Remove ${label} from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setMemberActionUserId(user.user_id);
            try {
              await removeGroupThreadMember(groupId, user.user_id);
              await refreshMembers();
            } catch (error) {
              Alert.alert('Error', supabaseErrorToUserMessage(error));
            } finally {
              setMemberActionUserId(null);
            }
          },
        },
      ],
    );
  }, [canManageMembers, groupId, memberActionUserId, refreshMembers]);

  const composerBottom =
    keyboardHeight > 0
      ? keyboardHeight + 6
      : tabBarMetrics.height + tabBarMetrics.bottom + 8;

  const renderMessage = useCallback(({ item }: { item: GroupMessageItem }) => {
    const isMine = item.sender_id === myId;
    const tone = toneForUserId(item.sender_id);
    const sender = item.sender_username ?? memberById.get(item.sender_id)?.username ?? `${item.sender_id.slice(0, 6)}...`;

    return (
      <View style={[styles.messageWrap, isMine ? styles.messageWrapMine : styles.messageWrapOther]}>
        <Text style={[styles.senderLabel, { color: tone.label }, isMine && styles.senderLabelMine]} numberOfLines={1}>
          {sender}
        </Text>
        <View style={[styles.messageBubble, { backgroundColor: tone.bubble, borderColor: tone.border }, isMine ? styles.messageBubbleMine : styles.messageBubbleOther]}>
          <Text style={styles.messageText}>{item.body}</Text>
          <Text style={styles.messageTime}>{formatTime(item.created_at)}</Text>
        </View>
      </View>
    );
  }, [memberById, myId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  }

  if (screenError || !group) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{screenError ?? 'Group unavailable.'}</Text>
        <TouchableOpacity style={styles.backPill} onPress={() => router.replace(backHref)} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={16} color={colors.textPrimary} />
          <Text style={styles.backPillText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerIconBtn} onPress={() => router.replace(backHref)} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Avatar uri={group.avatar_url} fallback={group.title} size="sm" />
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>{group.title}</Text>
            <Text style={styles.headerMeta} numberOfLines={1}>{members.length} member(s)</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.headerIconBtn} onPress={() => setMembersVisible(true)} activeOpacity={0.8}>
          <Ionicons name="people-outline" size={20} color={colors.accentSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.memberStrip}
      >
        {members.map((member) => {
          const label = displayMemberName(member);
          return (
            <View key={member.id} style={styles.memberChip}>
              <Text style={styles.memberChipText} numberOfLines={1}>{label}</Text>
            </View>
          );
        })}
      </ScrollView>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item: GroupMessageItem) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: composerBottom + 90 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text style={styles.emptyText}>No messages yet. Start this group chat.</Text>}
      />

      {sendError ? (
        <View style={styles.sendErrorWrap}>
          <Text style={styles.sendErrorText}>{sendError}</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.inputRow,
          {
            marginBottom: composerBottom,
            paddingBottom: keyboardHeight > 0 ? 6 : Math.max(8, insets.bottom + 2),
          },
        ]}
      >
        <TextInput
          style={styles.input}
          placeholder="Message..."
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={sendText}
          disabled={!input.trim() || sending}
          activeOpacity={0.82}
        >
          {sending ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Ionicons name="send" size={18} color={colors.onAccent} />}
        </TouchableOpacity>
      </View>

      <Modal
        visible={membersVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMembersVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Members</Text>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setMembersVisible(false)}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={members}
              keyExtractor={(item: GroupThreadMemberItem) => item.id}
              renderItem={({ item }: { item: GroupThreadMemberItem }) => {
                const label = displayMemberName(item);
                const roleLabel = item.role.toUpperCase();
                const canRemove =
                  canManageMembers
                  && item.user_id !== group.owner_id
                  && item.user_id !== myId;
                return (
                  <View style={styles.memberRow}>
                    <Avatar uri={item.avatar_url} fallback={label} size="sm" />
                    <View style={styles.memberCopy}>
                      <Text style={styles.memberName} numberOfLines={1}>{label}</Text>
                      <Text style={styles.memberRole}>{roleLabel}</Text>
                    </View>
                    {canRemove ? (
                      <TouchableOpacity
                        style={styles.memberRemoveBtn}
                        onPress={() => removeMember(item)}
                        disabled={memberActionUserId === item.user_id}
                      >
                        {memberActionUserId === item.user_id
                          ? <ActivityIndicator size="small" color={colors.error} />
                          : <Ionicons name="person-remove-outline" size={16} color={colors.error} />}
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              }}
              contentContainerStyle={styles.memberListContent}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={
                canManageMembers ? (
                  <TouchableOpacity
                    style={styles.addMemberBtn}
                    onPress={() => setAddMembersVisible(true)}
                    activeOpacity={0.82}
                  >
                    <Ionicons name="person-add-outline" size={18} color={colors.onAccent} />
                    <Text style={styles.addMemberBtnText}>Add member</Text>
                  </TouchableOpacity>
                ) : null
              }
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={addMembersVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddMembersVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Friends</Text>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setAddMembersVisible(false)}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {friendsLoading ? (
              <View style={styles.centerInline}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : (
              <FlatList
                data={addableFriends}
                keyExtractor={(item: FriendListItem) => item.id}
                renderItem={({ item }: { item: FriendListItem }) => {
                  const label = item.username ?? item.email ?? `${item.id.slice(0, 8)}...`;
                  return (
                    <View style={styles.memberRow}>
                      <Avatar uri={item.avatar_url} fallback={label} size="sm" />
                      <View style={styles.memberCopy}>
                        <Text style={styles.memberName} numberOfLines={1}>{label}</Text>
                        <Text style={styles.memberRole}>{item.email ?? 'Friend'}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.memberAddBtn}
                        onPress={() => addMember(item.id)}
                        disabled={memberActionUserId === item.id}
                      >
                        {memberActionUserId === item.id
                          ? <ActivityIndicator size="small" color={colors.onAccent} />
                          : <Ionicons name="add" size={16} color={colors.onAccent} />}
                      </TouchableOpacity>
                    </View>
                  );
                }}
                contentContainerStyle={styles.memberListContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={<Text style={styles.emptyText}>No friends available to add.</Text>}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg },
  centerInline: { paddingVertical: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: colors.error, fontSize: 14, textAlign: 'center' },
  backPill: {
    marginTop: spacing.md,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    backgroundColor: colors.bgCard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  backPillText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    padding: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    backgroundColor: colors.bgCard,
    gap: 8,
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  headerMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  memberStrip: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  memberChip: {
    maxWidth: 160,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    backgroundColor: colors.bgCardAlt,
    paddingHorizontal: 10,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  emptyText: {
    marginTop: spacing.lg,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  messageWrap: {
    marginBottom: 10,
    maxWidth: '86%',
  },
  messageWrapMine: { alignSelf: 'flex-end' },
  messageWrapOther: { alignSelf: 'flex-start' },
  senderLabel: {
    fontSize: 11,
    marginBottom: 4,
    marginHorizontal: 6,
    fontWeight: '700',
  },
  senderLabelMine: {
    textAlign: 'right',
  },
  messageBubble: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  messageBubbleMine: {
    borderBottomRightRadius: 4,
  },
  messageBubbleOther: {
    borderBottomLeftRadius: 4,
  },
  messageText: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  messageTime: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textMuted,
    alignSelf: 'flex-end',
  },
  sendErrorWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: 8,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(251,113,133,0.12)',
  },
  sendErrorText: {
    fontSize: 13,
    color: colors.error,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginHorizontal: spacing.lg,
    gap: 8,
    padding: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    backgroundColor: colors.bgCard,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '78%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  memberListContent: {
    paddingBottom: spacing.lg,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  memberCopy: {
    flex: 1,
    minWidth: 0,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  memberRole: {
    marginTop: 1,
    fontSize: 12,
    color: colors.textMuted,
  },
  memberRemoveBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.35)',
    backgroundColor: 'rgba(251,113,133,0.08)',
  },
  addMemberBtn: {
    marginTop: spacing.md,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.accent,
  },
  addMemberBtnText: {
    color: colors.onAccent,
    fontWeight: '700',
    fontSize: 14,
  },
  memberAddBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
});
