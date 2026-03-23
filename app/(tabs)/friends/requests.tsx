import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { acceptFriendRequest, declineFriendRequest } from '@/lib/friendRequests';
import { useAuthStore } from '@/store/useAuthStore';
import { useFriendRequestsStore } from '@/store/useFriendRequestsStore';
import { supabaseErrorToUserMessage } from '@/lib/supabaseErrors';
import { Avatar } from '@/ui/components/Avatar';
import { EmptyState } from '@/ui/components/EmptyState';
import { colors, radius, spacing } from '@/ui/theme';

type IncomingRequest = {
  id: string;
  requester_id: string;
  receiver_id: string;
  created_at: string;
  requester: { username: string | null } | null;
};

export default function RequestsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const refreshPendingIncoming = useFriendRequestsStore((s) => s.refreshPendingIncoming);
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingRequestId, setActingRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!userId) { setRequests([]); setLoading(false); return; }
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('friend_requests')
      .select('id, requester_id, receiver_id, created_at, requester:profiles!requester_id(username)')
      .eq('receiver_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setLoading(false);
    if (fetchError) return;
    setRequests((data ?? []) as IncomingRequest[]);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      setError(null);
      refreshPendingIncoming();
      loadRequests();
    }, [loadRequests, refreshPendingIncoming]),
  );

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`friend_requests:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_requests' }, (payload) => {
        const row = payload.new as { receiver_id: string; status: string };
        if (row.receiver_id === userId && row.status === 'pending') { loadRequests(); refreshPendingIncoming(); }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friend_requests' }, (payload) => {
        const row = payload.new as { receiver_id: string };
        if (row.receiver_id === userId) { loadRequests(); refreshPendingIncoming(); }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, loadRequests, refreshPendingIncoming]);

  const acceptRequest = async (req: IncomingRequest) => {
    if (!userId) return;
    setActingRequestId(req.id);
    setError(null);
    const { error: err } = await acceptFriendRequest(req.id);
    setActingRequestId(null);
    if (err) {
      const msg = supabaseErrorToUserMessage(err);
      setError(msg);
      Alert.alert('Accept failed', msg);
      return;
    }
    setRequests((prev) => prev.filter((r) => r.id !== req.id));
    refreshPendingIncoming();
  };

  const declineRequest = async (req: IncomingRequest) => {
    setActingRequestId(req.id);
    setError(null);
    const { error: err } = await declineFriendRequest(req.id);
    setActingRequestId(null);
    if (err) { setError(supabaseErrorToUserMessage(err)); return; }
    setRequests((prev) => prev.filter((r) => r.id !== req.id));
    refreshPendingIncoming();
  };

  const renderItem = ({ item: req }: { item: IncomingRequest }) => {
    const requester = Array.isArray(req.requester) ? req.requester[0] : req.requester;
    const username = requester?.username ?? req.requester_id.slice(0, 8) + '…';
    const busy = actingRequestId === req.id;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Avatar uri={null} fallback={username} size="md" />
          <Text style={styles.username}>{username}</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptBtn, busy && styles.buttonDisabled]}
            onPress={() => acceptRequest(req)}
            disabled={busy}
            activeOpacity={0.7}
          >
            {busy ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.acceptBtnText}>Accept</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.declineBtn, busy && styles.buttonDisabled]}
            onPress={() => declineRequest(req)}
            disabled={busy}
            activeOpacity={0.7}
          >
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Friend requests</Text>
        <View style={{ width: 40 }} />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : requests.length === 0 ? (
        <EmptyState icon="mail-outline" title="No pending requests." />
      ) : (
        <FlatList<IncomingRequest>
          data={requests}
          keyExtractor={(item: IncomingRequest) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          style={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgCardBorder,
  },
  backBtn: { padding: 8, marginRight: 4 },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
  list: { flex: 1 },
  listContent: { padding: spacing.md, paddingBottom: 24 },
  errorBox: { margin: spacing.md, padding: 12, backgroundColor: 'rgba(248,113,113,0.12)', borderRadius: radius.sm },
  errorText: { fontSize: 14, color: colors.error },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    padding: 14,
    marginBottom: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  username: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: 10 },
  acceptBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    minWidth: 100,
    alignItems: 'center',
  },
  acceptBtnText: { fontSize: 14, fontWeight: '600', color: colors.bg },
  declineBtn: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
  },
  declineBtnText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  buttonDisabled: { opacity: 0.5 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
});
