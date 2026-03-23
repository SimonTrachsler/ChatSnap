import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/useAuthStore';
import { useActiveThreadStore } from '@/store/useActiveThreadStore';
import { useInboxBadgeStore } from '@/store/useInboxBadgeStore';
import { createOutgoingCallSession, probeCallReadiness } from '@/lib/calls';
import {
  canOpenChatWithUser,
  getOrCreateThread,
  isOnlyFriendsChatError,
  listMessages,
  markThreadRead,
  sendMessage as sendMessageApi,
  subscribeToMessages,
  type ChatMessage,
} from '@/lib/chat';
import { supabase } from '@/lib/supabase';
import { supabaseErrorToUserMessage } from '@/lib/supabaseErrors';
import { Avatar } from '@/ui/components/Avatar';
import { colors, radius, spacing } from '@/ui/theme';
import { getFloatingTabBarMetrics } from '@/ui/tabBar';

type ScrollableListRef = { scrollToEnd?: (options: { animated?: boolean }) => void };
const CHAT_NOT_FRIENDS_MESSAGE = 'Chat is only available for friends.';

function normalizeUserIdParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    const trimmed = value[0].trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

type ThreadChatScreenProps = {
  backHref: '/(tabs)/inbox' | '/(tabs)/friends';
  showProfileLink?: boolean;
};

export function ThreadChatScreen({ backHref, showProfileLink = false }: ThreadChatScreenProps) {
  const params = useLocalSearchParams<{ userId?: string | string[] }>();
  const friendId = normalizeUserIdParam(params.userId);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarMetrics = getFloatingTabBarMetrics(insets);
  const myId = useAuthStore((s) => s.user?.id) ?? null;
  const setActiveThreadId = useActiveThreadStore((s) => s.setActiveThreadId);
  const refreshUnreadMessages = useInboxBadgeStore((s) => s.refreshUnreadMessages);

  const [username, setUsername] = useState<string | null>(null);
  const [friendAvatar, setFriendAvatar] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [startingCall, setStartingCall] = useState(false);
  const [callReady, setCallReady] = useState<boolean>(true);
  const [callReadyMessage, setCallReadyMessage] = useState<string | null>(null);
  const [checkingCallReadiness, setCheckingCallReadiness] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const listRef = useRef<React.ElementRef<typeof FlatList>>(null);
  const loadRequestRef = useRef(0);
  const displayName = username ?? (friendId ? `${friendId.slice(0, 8)}...` : 'Chat');

  const handleBack = useCallback(() => {
    router.replace(backHref);
  }, [backHref, router]);

  useEffect(() => {
    let cancelled = false;
    if (!friendId) {
      setUsername(null);
      setFriendAvatar(null);
      return () => {
        cancelled = true;
      };
    }
    supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', friendId)
      .maybeSingle()
      .then((res) => {
        if (cancelled) return;
        const data = res.data as { username?: string | null; avatar_url?: string | null } | null;
        setUsername(data?.username ?? null);
        setFriendAvatar(data?.avatar_url ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [friendId]);

  const loadThreadAndMessages = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    const isStale = () => loadRequestRef.current !== requestId;

    if (!myId || !friendId || myId === friendId) {
      if (isStale()) return;
      setThreadId(null);
      setMessages([]);
      setThreadError(myId && friendId && myId === friendId ? 'You cannot chat with yourself.' : null);
      setLoading(false);
      setActiveThreadId(null);
      return;
    }

    if (isStale()) return;
    setLoading(true);
    setThreadError(null);

    try {
      const allowed = await canOpenChatWithUser(myId, friendId);
      if (isStale()) return;
      if (!allowed) {
        setThreadError(CHAT_NOT_FRIENDS_MESSAGE);
        setThreadId(null);
        setMessages([]);
        setActiveThreadId(null);
        handleBack();
        return;
      }

      const tid = await getOrCreateThread(friendId);
      if (isStale()) return;
      setThreadId(tid);
      setActiveThreadId(tid);

      const list = await listMessages(tid);
      if (isStale()) return;
      setMessages(list);
      markThreadRead(tid)
        .then(() => refreshUnreadMessages())
        .catch(() => {});
    } catch (error) {
      if (isStale()) return;
      if (!isOnlyFriendsChatError(error)) {
        console.error('[chat] loadThreadAndMessages error:', error);
      }
      const msg = isOnlyFriendsChatError(error) ? CHAT_NOT_FRIENDS_MESSAGE : supabaseErrorToUserMessage(error);
      setThreadError(msg);
      setThreadId(null);
      setMessages([]);
      setActiveThreadId(null);
      if (isOnlyFriendsChatError(error)) {
        handleBack();
      }
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [friendId, handleBack, myId, refreshUnreadMessages, setActiveThreadId]);

  useEffect(() => {
    loadThreadAndMessages();
    return () => {
      loadRequestRef.current += 1;
      setActiveThreadId(null);
    };
  }, [loadThreadAndMessages, setActiveThreadId]);

  useEffect(() => {
    if (!threadId) return;
    const unsub = subscribeToMessages(threadId, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });
      if (msg.sender_id !== myId) {
        markThreadRead(threadId)
          .then(() => refreshUnreadMessages())
          .catch(() => {});
      }
    });
    return unsub;
  }, [myId, refreshUnreadMessages, threadId]);

  useEffect(() => {
    if (messages.length > 0) {
      (listRef.current as ScrollableListRef | null)?.scrollToEnd?.({ animated: true });
    }
  }, [messages.length]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!friendId || !myId) {
      setCallReady(false);
      setCallReadyMessage('Audio calls are unavailable.');
      setCheckingCallReadiness(false);
      return () => {
        cancelled = true;
      };
    }

    setCheckingCallReadiness(true);
    probeCallReadiness()
      .then((readiness) => {
        if (cancelled) return;
        setCallReady(readiness.success);
        setCallReadyMessage(readiness.message ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setCallReady(false);
        setCallReadyMessage('Could not verify audio call configuration.');
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingCallReadiness(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [friendId, myId]);

  const composerBottomOffset = keyboardVisible ? 1 : tabBarMetrics.height + tabBarMetrics.bottom + 8;
  const composerBottomPadding = keyboardVisible ? 3 : Math.max(10, insets.bottom + 4);
  const listBottomPadding = composerBottomOffset + 86;

  const sendMessage = async () => {
    const body = input.trim();
    if (!body || !threadId || sending || !myId) return;
    setSending(true);
    setSendError(null);
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      thread_id: threadId,
      sender_id: myId,
      body,
      message_type: 'text',
      snap_id: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    try {
      const inserted = await sendMessageApi(threadId, body);
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? inserted : m)).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
      );
      setTimeout(() => (listRef.current as ScrollableListRef | null)?.scrollToEnd?.({ animated: true }), 100);
    } catch (error) {
      console.error('[chat] sendMessage error:', error);
      setSendError(supabaseErrorToUserMessage(error));
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(body);
    } finally {
      setSending(false);
    }
  };

  const handleStartCall = useCallback(async () => {
    if (!friendId || !myId || startingCall || checkingCallReadiness) return;
    if (!callReady) {
      Alert.alert('Audio call unavailable', callReadyMessage ?? 'Audio calls are not configured yet.');
      return;
    }
    setStartingCall(true);
    try {
      const session = await createOutgoingCallSession(friendId);
      router.push(`/call/${session.id}`);
    } catch (error) {
      Alert.alert('Call failed', supabaseErrorToUserMessage(error));
    } finally {
      setStartingCall(false);
    }
  }, [callReady, callReadyMessage, checkingCallReadiness, friendId, myId, router, startingCall]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }): React.ReactElement => {
      const isSent = item.sender_id === myId;
      const isSnap = item.message_type === 'snap' && item.snap_id;
      const isOpenedSnap = isSnap && item.snapOpened;
      const snapLabel = isSent ? 'Snap sent' : 'Open snap';
      return (
        <View style={[styles.bubbleWrap, isSent ? styles.bubbleWrapSent : styles.bubbleWrapReceived]}>
          {isSnap ? (
            isOpenedSnap ? (
              <View style={[styles.snapBubble, isSent ? styles.bubbleSent : styles.bubbleReceived]}>
                <Ionicons name="eye-off-outline" size={20} color={isSent ? colors.textPrimary : colors.textMuted} />
                <Text style={[styles.snapBubbleTextOpened, isSent && styles.bubbleTextSent]}>Opened</Text>
                <Text style={[styles.bubbleTime, isSent ? styles.bubbleTimeSent : styles.bubbleTimeReceived]}>
                  {formatTime(item.created_at)}
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.snapBubble, isSent ? styles.bubbleSent : styles.bubbleReceived]}
                onPress={isSent ? undefined : () => router.push(`/snap/${item.snap_id}`)}
                disabled={isSent}
                activeOpacity={isSent ? 1 : 0.8}
              >
                <Ionicons name="camera" size={20} color={isSent ? colors.textMuted : colors.accentSecondary} />
                <Text style={[styles.snapBubbleText, isSent && styles.snapBubbleTextDisabled]}>{snapLabel}</Text>
                <Text style={[styles.bubbleTime, isSent ? styles.bubbleTimeSent : styles.bubbleTimeReceived]}>
                  {formatTime(item.created_at)}
                </Text>
              </TouchableOpacity>
            )
          ) : (
            <View style={[styles.bubble, isSent ? styles.bubbleSent : styles.bubbleReceived]}>
              <Text style={[styles.bubbleText, isSent && styles.bubbleTextSent]}>{item.body}</Text>
              <Text style={[styles.bubbleTime, isSent ? styles.bubbleTimeSent : styles.bubbleTimeReceived]}>
                {formatTime(item.created_at)}
              </Text>
            </View>
          )}
        </View>
      );
    },
    [myId, router],
  );

  if (threadError) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.82}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            Chat
          </Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{threadError}</Text>
          <TouchableOpacity style={styles.errorBtn} onPress={handleBack} activeOpacity={0.82}>
            <Text style={styles.errorBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.82}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        {showProfileLink ? (
          <TouchableOpacity
            style={styles.headerProfile}
            onPress={() => friendId && router.push(`/(tabs)/friends/detail/${friendId}`)}
            activeOpacity={0.82}
          >
            <Avatar uri={friendAvatar} fallback={displayName} size="sm" />
            <Text style={styles.title} numberOfLines={1}>
              {displayName}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerProfile}>
            <Avatar uri={friendAvatar} fallback={displayName} size="sm" />
            <Text style={styles.title} numberOfLines={1}>
              {displayName}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.callBtn, (!friendId || startingCall || checkingCallReadiness || !callReady) && styles.callBtnDisabled]}
          onPress={handleStartCall}
          disabled={!friendId || startingCall || checkingCallReadiness || !callReady}
          activeOpacity={0.82}
        >
          {startingCall || checkingCallReadiness ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Ionicons name="call-outline" size={20} color={colors.textPrimary} />
          )}
        </TouchableOpacity>
      </View>
      {!checkingCallReadiness && !callReady && callReadyMessage ? (
        <View style={styles.callInfoBar}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
          <Text style={styles.callInfoText} numberOfLines={2}>
            {callReadyMessage}
          </Text>
        </View>
      ) : null}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : (
        <FlatList<ChatMessage>
          ref={listRef}
          data={messages}
          keyExtractor={(item: ChatMessage) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: listBottomPadding }]}
          style={styles.list}
          initialNumToRender={16}
          windowSize={8}
          maxToRenderPerBatch={12}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>No messages yet.</Text>
            </View>
          }
        />
      )}
      {sendError ? (
        <View style={styles.sendErrorBox}>
          <Text style={styles.sendErrorText}>{sendError}</Text>
        </View>
      ) : null}
      <View style={[styles.inputRow, { marginBottom: composerBottomOffset, paddingBottom: composerBottomPadding }]}>
        <TextInput
          style={styles.input}
          placeholder="Message..."
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          onFocus={() => setKeyboardVisible(true)}
          onBlur={() => setKeyboardVisible(false)}
          multiline
          maxLength={2000}
          editable={!sending && !!threadId}
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending || !threadId) && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!input.trim() || sending || !threadId}
          activeOpacity={0.82}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <Ionicons name="send" size={20} color={colors.onAccent} />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    borderRadius: radius.lg,
    gap: 8,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCardAlt,
  },
  callBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  callBtnDisabled: {
    opacity: 0.55,
  },
  headerProfile: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10, minWidth: 0 },
  headerSpacer: { width: 40 },
  title: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  callInfoBar: {
    marginHorizontal: spacing.lg,
    marginTop: -4,
    marginBottom: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    backgroundColor: 'rgba(15,23,42,0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  callInfoText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  emptyWrap: { paddingVertical: 48, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, color: colors.textMuted },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 15, color: colors.error, textAlign: 'center', marginBottom: 16 },
  errorBtn: { paddingVertical: 12, paddingHorizontal: 22, backgroundColor: colors.accent, borderRadius: radius.md },
  errorBtnText: { fontSize: 16, fontWeight: '700', color: colors.onAccent },
  bubbleWrap: { marginBottom: 8, maxWidth: '85%' },
  bubbleWrapSent: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapReceived: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 20, maxWidth: '100%' },
  bubbleSent: { backgroundColor: colors.bubbleSent, borderBottomRightRadius: 4 },
  bubbleReceived: {
    backgroundColor: colors.bubbleReceived,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  bubbleText: { fontSize: 15, color: colors.textPrimary },
  bubbleTextSent: { color: colors.textPrimary },
  snapBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    maxWidth: '100%',
    gap: 8,
    flexWrap: 'wrap',
  },
  snapBubbleText: { fontSize: 14, fontWeight: '700', color: colors.accentSecondary },
  snapBubbleTextDisabled: { color: colors.textMuted },
  snapBubbleTextOpened: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  bubbleTime: { fontSize: 11, marginTop: 4 },
  bubbleTimeSent: { color: 'rgba(248,250,252,0.78)' },
  bubbleTimeReceived: { color: colors.textMuted },
  sendErrorBox: {
    marginHorizontal: 12,
    marginVertical: 8,
    padding: 12,
    backgroundColor: 'rgba(251,113,133,0.12)',
    borderRadius: radius.sm,
  },
  sendErrorText: { fontSize: 14, color: colors.error },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginHorizontal: spacing.lg,
    padding: 10,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    borderRadius: radius.lg,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
