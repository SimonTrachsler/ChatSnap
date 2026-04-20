import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/useAuthStore';
import { useActiveThreadStore } from '@/store/useActiveThreadStore';
import { useInboxBadgeStore } from '@/store/useInboxBadgeStore';
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
import {
  deleteOwnChatMessage,
  dispatchDueScheduledMessages,
  getChatMediaSignedUrl,
  listMessageReactions,
  scheduleChatMessage,
  sendRichChatMessage,
  toggleMessageReaction,
  updateOwnChatMessage,
  uploadChatImageFromUri,
  type MessageReactionSummary,
} from '@/lib/socialFeatures';
import { supabase } from '@/lib/supabase';
import { supabaseErrorToUserMessage } from '@/lib/supabaseErrors';
import { Avatar } from '@/ui/components/Avatar';
import { colors, radius, spacing } from '@/ui/theme';
import { getFloatingTabBarMetrics } from '@/ui/tabBar';

const CHAT_NOT_FRIENDS_MESSAGE = 'Chat is only available for friends.';
const REACTIONS = ['👍', '❤️', '😂', '🔥'];
const SCHEDULE_STEPS: Array<0 | 5 | 30> = [0, 5, 30];

type ThreadChatScreenProps = {
  backHref: '/(tabs)/inbox' | '/(tabs)/friends';
  showProfileLink?: boolean;
};

function normalizeUserIdParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return null;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function scheduleLabel(minutes: 0 | 5 | 30): string {
  return minutes === 0 ? 'Now' : `+${minutes}m`;
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

type SnapVisualState = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  accentColor: string;
  tintBackground: string;
};

function getSnapVisualState(isSent: boolean, snapOpened: boolean): SnapVisualState {
  if (isSent) {
    if (snapOpened) {
      return {
        icon: 'checkmark-done-outline',
        title: 'Opened',
        subtitle: 'Friend viewed your snap',
        accentColor: '#C7D0DB',
        tintBackground: 'rgba(148,163,184,0.16)',
      };
    }
    return {
      icon: 'paper-plane-outline',
      title: 'Sent',
      subtitle: 'Waiting for friend to open',
      accentColor: '#AEB8C4',
      tintBackground: 'rgba(148,163,184,0.12)',
    };
  }

  if (snapOpened) {
    return {
      icon: 'eye-off-outline',
      title: 'Opened',
      subtitle: 'You already viewed this snap',
      accentColor: '#AFC8FF',
      tintBackground: 'rgba(175,200,255,0.12)',
    };
  }
  return {
    icon: 'sparkles-outline',
    title: 'New snap',
    subtitle: 'Tap to open',
    accentColor: '#FFB2F5',
    tintBackground: 'rgba(255,178,245,0.12)',
  };
}

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
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [scheduleMinutes, setScheduleMinutes] = useState<0 | 5 | 30>(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [editingBusy, setEditingBusy] = useState(false);
  const [reactions, setReactions] = useState<Record<string, MessageReactionSummary[]>>({});
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const listRef = useRef<{ scrollToEnd?: (options?: { animated?: boolean }) => void } | null>(null);
  const requestRef = useRef(0);
  const reactionKeyRef = useRef('');
  const resolvedMediaIdsRef = useRef(new Set<string>());
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledDispatchTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const displayName = username ?? (friendId ? `${friendId.slice(0, 8)}...` : 'Chat');
  const handleBack = useCallback(() => router.replace(backHref), [backHref, router]);
  const onCycleSchedule = useCallback(() => {
    const idx = SCHEDULE_STEPS.indexOf(scheduleMinutes);
    setScheduleMinutes(SCHEDULE_STEPS[(idx + 1) % SCHEDULE_STEPS.length]);
  }, [scheduleMinutes]);
  const queueMarkThreadRead = useCallback((targetThreadId: string) => {
    if (markReadTimerRef.current) return;
    markReadTimerRef.current = setTimeout(() => {
      markReadTimerRef.current = null;
      markThreadRead(targetThreadId).then(() => refreshUnreadMessages({ force: true })).catch(() => {});
    }, 180);
  }, [refreshUnreadMessages]);
  const queueScheduledDispatch = useCallback((scheduledForIso: string) => {
    const dueAtMs = new Date(scheduledForIso).getTime();
    if (!Number.isFinite(dueAtMs)) return;
    const delayMs = Math.max(400, dueAtMs - Date.now() + 400);
    const timer = setTimeout(() => {
      scheduledDispatchTimersRef.current.delete(timer);
      dispatchDueScheduledMessages().then(() => refreshUnreadMessages({ force: true })).catch(() => {});
    }, delayMs);
    scheduledDispatchTimersRef.current.add(timer);
  }, [refreshUnreadMessages]);

  useEffect(() => {
    let cancelled = false;
    if (!friendId) return;
    supabase.from('profiles').select('username, avatar_url').eq('id', friendId).maybeSingle().then((res) => {
      if (cancelled) return;
      const profile = res.data as { username?: string | null; avatar_url?: string | null } | null;
      setUsername(profile?.username ?? null);
      setFriendAvatar(profile?.avatar_url ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [friendId]);

  const loadThread = useCallback(async () => {
    const req = requestRef.current + 1;
    requestRef.current = req;
    const stale = () => requestRef.current !== req;
    if (!myId || !friendId || myId === friendId) {
      if (stale()) return;
      setThreadError(myId && friendId && myId === friendId ? 'You cannot chat with yourself.' : null);
      setThreadId(null);
      setMessages([]);
      setLoading(false);
      setActiveThreadId(null);
      return;
    }
    setLoading(true);
    setThreadError(null);
    try {
      const allowed = await canOpenChatWithUser(myId, friendId);
      if (stale()) return;
      if (!allowed) {
        setThreadError(CHAT_NOT_FRIENDS_MESSAGE);
        setThreadId(null);
        setMessages([]);
        setActiveThreadId(null);
        handleBack();
        return;
      }
      const nextThreadId = await getOrCreateThread(friendId);
      if (stale()) return;
      setThreadId(nextThreadId);
      setActiveThreadId(nextThreadId);
      const list = await listMessages(nextThreadId);
      if (stale()) return;
      setMessages(list);
      queueMarkThreadRead(nextThreadId);
    } catch (error) {
      if (stale()) return;
      const msg = isOnlyFriendsChatError(error) ? CHAT_NOT_FRIENDS_MESSAGE : supabaseErrorToUserMessage(error);
      setThreadError(msg);
      setThreadId(null);
      setMessages([]);
      setActiveThreadId(null);
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [friendId, handleBack, myId, queueMarkThreadRead, setActiveThreadId]);

  useFocusEffect(useCallback(() => {
    loadThread();
    return () => {
      requestRef.current += 1;
      setActiveThreadId(null);
    };
  }, [loadThread, setActiveThreadId]));

  useEffect(() => () => {
    if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    for (const timer of scheduledDispatchTimersRef.current) clearTimeout(timer);
    scheduledDispatchTimersRef.current.clear();
  }, []);

  useEffect(() => {
    resolvedMediaIdsRef.current = new Set<string>();
    setMediaUrls({});
    reactionKeyRef.current = '';
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const unsub = subscribeToMessages(threadId, (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (msg.sender_id !== myId) queueMarkThreadRead(threadId);
    });
    return unsub;
  }, [myId, queueMarkThreadRead, threadId]);

  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd?.({ animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  useEffect(() => {
    if (!threadId) return;
    dispatchDueScheduledMessages().then(() => refreshUnreadMessages({ force: true })).catch(() => {});
    const t = setInterval(() => {
      dispatchDueScheduledMessages().then(() => refreshUnreadMessages({ force: true })).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [refreshUnreadMessages, threadId]);

  useEffect(() => {
    const ids = messages.map((m) => m.id);
    if (!ids.length) {
      setReactions({});
      reactionKeyRef.current = '';
      return;
    }
    const key = ids.join('|');
    if (key === reactionKeyRef.current) return;
    reactionKeyRef.current = key;
    listMessageReactions(ids).then((res) => setReactions(res.byMessage)).catch(() => {});
  }, [messages]);

  useEffect(() => {
    const mediaMessages = messages.filter((m) => !!m.media_path && !resolvedMediaIdsRef.current.has(m.id));
    if (!mediaMessages.length) return;
    let cancelled = false;
    Promise.all(
      mediaMessages.map(async (m) => {
        if (!m.media_path) return null;
        const signed = await getChatMediaSignedUrl(m.media_path, 7200);
        return signed ? ([m.id, signed] as const) : ([m.id, null] as const);
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const pair of pairs) {
        if (!pair) continue;
        resolvedMediaIdsRef.current.add(pair[0]);
        if (pair[1]) next[pair[0]] = pair[1];
      }
      if (Object.keys(next).length) setMediaUrls((prev) => ({ ...prev, ...next }));
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [messages]);

  useEffect(() => {
    const setVisibleHeightFromEvent = (event: unknown) => {
      setKeyboardHeight(getKeyboardInsetFromBottom(event));
    };
    if (Platform.OS === 'ios') {
      const show = Keyboard.addListener('keyboardWillChangeFrame', ((event: unknown) => setVisibleHeightFromEvent(event)) as unknown as () => void);
      const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
      return () => {
        show.remove();
        hide.remove();
      };
    }
    const show = Keyboard.addListener('keyboardDidShow', ((event: unknown) => setVisibleHeightFromEvent(event)) as unknown as () => void);
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const refreshReactions = useCallback(async () => {
    const ids = messages.map((m) => m.id);
    if (!ids.length) return;
    const res = await listMessageReactions(ids);
    setReactions(res.byMessage);
  }, [messages]);

  const sendText = useCallback(async () => {
    const body = input.trim();
    if (!body || !threadId || !myId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      if (scheduleMinutes > 0) {
        const scheduledFor = new Date(Date.now() + scheduleMinutes * 60000).toISOString();
        await scheduleChatMessage(threadId, { body, scheduledFor });
        queueScheduledDispatch(scheduledFor);
        setInput('');
        setScheduleMinutes(0);
      } else {
        await sendMessageApi(threadId, body);
        setInput('');
      }
    } catch (error) {
      setSendError(supabaseErrorToUserMessage(error));
    } finally {
      setSending(false);
    }
  }, [input, myId, queueScheduledDispatch, scheduleMinutes, sending, threadId]);

  const pickAndSendPhoto = useCallback(async () => {
    if (!threadId || !myId || uploadingMedia) return;
    setUploadingMedia(true);
    setSendError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        setSendError('Media library permission is required to send photos.');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets?.[0];
      if (!asset?.uri) return;
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG },
      );
      const upload = await uploadChatImageFromUri(myId, manipulated.uri ?? asset.uri);
      await sendRichChatMessage(threadId, {
        body: 'Photo',
        messageType: 'image',
        mediaPath: upload.path,
        metadata: {
          mimeType: upload.mimeType,
          width: asset.width ?? null,
          height: asset.height ?? null,
        },
      });
    } catch (error) {
      setSendError(supabaseErrorToUserMessage(error));
    } finally {
      setUploadingMedia(false);
    }
  }, [myId, threadId, uploadingMedia]);

  const handleMessageAction = useCallback((msg: ChatMessage) => {
    const isOwn = msg.sender_id === myId;
    const canEdit = isOwn
      && msg.message_type === 'text'
      && !msg.deleted_at
      && Date.now() - new Date(msg.created_at).getTime() <= 15 * 60 * 1000;
    Alert.alert('Message', 'Choose action', [
      ...REACTIONS.map((emoji) => ({ text: `${emoji} React`, onPress: () => toggleMessageReaction(msg.id, emoji).then(refreshReactions).catch(() => {}) })),
      ...(canEdit ? [{ text: 'Edit', onPress: () => { setEditingId(msg.id); setEditingDraft(msg.body); } }, { text: 'Delete', style: 'destructive' as const, onPress: () => deleteOwnChatMessage(msg.id).then(() => loadThread()).catch(() => {}) }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [loadThread, myId, refreshReactions]);

  const submitEdit = useCallback(async () => {
    if (!editingId || !editingDraft.trim() || editingBusy) return;
    setEditingBusy(true);
    try {
      await updateOwnChatMessage(editingId, editingDraft.trim());
      setEditingId(null);
      setEditingDraft('');
      await loadThread();
    } catch (error) {
      setSendError(supabaseErrorToUserMessage(error));
    } finally {
      setEditingBusy(false);
    }
  }, [editingBusy, editingDraft, editingId, loadThread]);

  const composerBottom = keyboardHeight > 0
    ? keyboardHeight + 6
    : tabBarMetrics.height + tabBarMetrics.bottom + 8;

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const isSent = item.sender_id === myId;
    const bubbleStyles = [styles.bubble, isSent ? styles.bubbleSent : styles.bubbleReceived];
    const isSnap = item.message_type === 'snap' && item.snap_id;
    const isImage = item.message_type === 'image' && !!item.media_path;
    const snapOpened = !!item.snapOpened;
    const snapVisual = getSnapVisualState(isSent, snapOpened);
    const mediaUrl = mediaUrls[item.id];
    const messageReactions = reactions[item.id] ?? [];
    return (
      <View style={[styles.msgWrap, isSent ? styles.msgWrapSent : styles.msgWrapRecv]}>
        <TouchableOpacity
          style={bubbleStyles}
          onLongPress={() => handleMessageAction(item)}
          activeOpacity={0.9}
          onPress={() => {
            if (isSnap && !isSent && item.snap_id && !snapOpened) router.push(`/snap/${item.snap_id}`);
          }}
        >
          {isSnap ? (
            <View style={[styles.snapCard, { backgroundColor: snapVisual.tintBackground }]}>
              <View style={[styles.snapIconWrap, { borderColor: snapVisual.accentColor }]}>
                <Ionicons name={snapVisual.icon} size={18} color={snapVisual.accentColor} />
              </View>
              <View style={styles.snapTextWrap}>
                <Text style={[styles.snapTitle, { color: snapVisual.accentColor }]}>{snapVisual.title}</Text>
                <Text style={styles.snapSubtitle}>{snapVisual.subtitle}</Text>
              </View>
            </View>
          ) : isImage ? (
            <View style={styles.chatImageWrap}>
              {mediaUrl ? (
                <Image source={{ uri: mediaUrl }} style={styles.chatImage} resizeMode="cover" />
              ) : (
                <View style={styles.chatImageFallback}>
                  <Ionicons name="image-outline" size={20} color={colors.textMuted} />
                  <Text style={styles.chatImageFallbackText}>Loading photo...</Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={[styles.msgText, item.deleted_at ? styles.deleted : null]}>{item.deleted_at ? '[deleted]' : item.body}</Text>
          )}
          <Text style={styles.msgTime}>{formatTime(item.created_at)}</Text>
        </TouchableOpacity>
        {messageReactions.length > 0 ? <View style={styles.reactRow}>{messageReactions.map((r) => <Text key={`${item.id}-${r.emoji}`} style={styles.reactBadge}>{`${r.emoji} ${r.count}`}</Text>)}</View> : null}
      </View>
    );
  };

  if (threadError) return <View style={styles.center}><Text style={styles.err}>{threadError}</Text></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}><Ionicons name="arrow-back" size={22} color={colors.textPrimary} /></TouchableOpacity>
        {showProfileLink ? <TouchableOpacity style={styles.headerProfile} onPress={() => friendId && router.push(`/(tabs)/friends/detail/${friendId}`)}><Avatar uri={friendAvatar} fallback={displayName} size="sm" /><Text style={styles.title}>{displayName}</Text></TouchableOpacity> : <View style={styles.headerProfile}><Avatar uri={friendAvatar} fallback={displayName} size="sm" /><Text style={styles.title}>{displayName}</Text></View>}
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : <FlatList ref={listRef} data={messages} renderItem={renderItem} keyExtractor={(item: ChatMessage) => item.id} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: composerBottom + 92 }} />}
      {sendError ? <View style={styles.errBox}><Text style={styles.errTxt}>{sendError}</Text></View> : null}
      {editingId ? <View style={styles.editRow}><TextInput style={styles.input} value={editingDraft} onChangeText={setEditingDraft} /><TouchableOpacity style={styles.actionBtn} onPress={submitEdit} disabled={editingBusy}><Ionicons name="checkmark" size={18} color={colors.onAccent} /></TouchableOpacity><TouchableOpacity style={[styles.actionBtn, styles.grayBtn]} onPress={() => { setEditingId(null); setEditingDraft(''); }}><Ionicons name="close" size={18} color={colors.textPrimary} /></TouchableOpacity></View> : null}
      <View style={[styles.inputRow, { marginBottom: composerBottom, paddingBottom: keyboardHeight > 0 ? 6 : Math.max(8, insets.bottom + 2) }]}>
        <TouchableOpacity style={styles.actionBtn} disabled={uploadingMedia} onPress={pickAndSendPhoto}>{uploadingMedia ? <ActivityIndicator color={colors.onAccent} size="small" /> : <Ionicons name="image-outline" size={18} color={colors.onAccent} />}</TouchableOpacity>
        <TextInput style={styles.input} placeholder="Message..." placeholderTextColor={colors.textMuted} value={input} onChangeText={setInput} multiline />
        <TouchableOpacity style={[styles.scheduleBtn, scheduleMinutes > 0 && styles.scheduleBtnOn]} onPress={onCycleSchedule}><Text style={styles.scheduleTxt}>{scheduleLabel(scheduleMinutes)}</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, !input.trim() && styles.disabled]} onPress={sendText} disabled={!input.trim() || sending}>{sending ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Ionicons name="send" size={18} color={colors.onAccent} />}</TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { color: colors.error, fontSize: 14 },
  errBox: { marginHorizontal: spacing.lg, marginBottom: 8, padding: 10, borderRadius: radius.sm, backgroundColor: 'rgba(251,113,133,0.12)' },
  errTxt: { color: colors.error, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.md, padding: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.bgCardBorder, backgroundColor: colors.bgCard, gap: 8 },
  backBtn: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCardAlt },
  headerProfile: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  msgWrap: { marginBottom: 8, maxWidth: '85%' },
  msgWrapSent: { alignSelf: 'flex-end' },
  msgWrapRecv: { alignSelf: 'flex-start' },
  bubble: { borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12 },
  bubbleSent: {
    backgroundColor: 'rgba(125,211,252,0.18)',
    borderBottomRightRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.34)',
  },
  bubbleReceived: {
    backgroundColor: 'rgba(148,163,184,0.20)',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.28)',
  },
  msgText: { color: colors.textPrimary, fontSize: 15 },
  chatImageWrap: {
    width: 190,
    height: 220,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,17,30,0.72)',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  chatImage: {
    width: '100%',
    height: '100%',
  },
  chatImageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  chatImageFallbackText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  snapCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
  },
  snapIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  snapTextWrap: {
    flexShrink: 1,
  },
  snapTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  snapSubtitle: {
    marginTop: 1,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  msgTime: { marginTop: 3, fontSize: 11, color: colors.textMuted, alignSelf: 'flex-end' },
  deleted: { fontStyle: 'italic', color: colors.textMuted },
  reactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  reactBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.bgCardBorder, backgroundColor: colors.bgCardAlt, color: colors.textSecondary, fontSize: 11 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.lg, marginBottom: 8, padding: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.bgCardBorder, backgroundColor: colors.bgCard },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: spacing.lg, gap: 8, padding: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.bgCardBorder, backgroundColor: colors.bgCard },
  input: { flex: 1, minHeight: 40, maxHeight: 100, borderRadius: 18, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.inputBg, color: colors.textPrimary, paddingHorizontal: 14, paddingVertical: 8, fontSize: 15 },
  actionBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  grayBtn: { backgroundColor: colors.bgCardAlt, borderWidth: 1, borderColor: colors.bgCardBorder },
  disabled: { opacity: 0.45 },
  scheduleBtn: { height: 38, minWidth: 56, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.bgCardBorder, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: colors.bgCardAlt },
  scheduleBtnOn: { borderColor: colors.accent, backgroundColor: 'rgba(255,138,91,0.16)' },
  scheduleTxt: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
});
