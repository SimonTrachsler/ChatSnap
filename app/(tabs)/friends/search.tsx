import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { searchProfiles, type ProfileSearchResult } from '@/lib/profileSearch';
import { useAuthStore } from '@/store/useAuthStore';
import { supabaseErrorToUserMessage } from '@/lib/supabaseErrors';
import {
  getRelationshipState,
  getRelationshipStates,
  sendFriendRequest,
  acceptFriendRequestByRequesterId,
  type RelationshipState,
} from '@/lib/friendRequests';
import { useFriendRequestsStore } from '@/store/useFriendRequestsStore';
import { Avatar } from '@/ui/components/Avatar';
import { colors, radius, spacing } from '@/ui/theme';

const DEBOUNCE_MS = 220;

export default function UserSearchScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const userId = useAuthStore((s) => s.user?.id);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGoToRequestsLink, setShowGoToRequestsLink] = useState(false);
  const [alreadyRequestedIds, setAlreadyRequestedIds] = useState<Set<string>>(new Set());
  const [relationshipByUserId, setRelationshipByUserId] = useState<Record<string, RelationshipState>>({});
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const refreshPendingIncoming = useFriendRequestsStore((s) => s.refreshPendingIncoming);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/friends');
  }, [navigation, router]);

  const runSearch = useCallback(async () => {
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    const isStale = () => searchRequestRef.current !== requestId;

    if (!userId) { setError('Not signed in.'); setResults([]); return; }
    const q = query.trim();
    if (!q) { setResults([]); setError(null); setShowGoToRequestsLink(false); return; }
    setError(null);
    setShowGoToRequestsLink(false);
    setLoading(true);
    try {
      const list = await searchProfiles(q, { currentUserId: userId });
      if (isStale()) return;
      setResults(list);
      if (list.length) {
        const states = await getRelationshipStates(userId, list.map((r) => r.id));
        if (isStale()) return;
        setRelationshipByUserId(states);
      } else {
        setRelationshipByUserId({});
      }
    } catch (e) {
      if (isStale()) return;
      setError(supabaseErrorToUserMessage(e));
      setResults([]);
      setRelationshipByUserId({});
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [query, userId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      searchRequestRef.current += 1;
      setResults([]);
      setError(null);
      setShowGoToRequestsLink(false);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => { debounceRef.current = null; runSearch(); }, DEBOUNCE_MS);
    return () => {
      searchRequestRef.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const handleAdd = useCallback(
    async (p: ProfileSearchResult) => {
      if (!userId) { setError('Not signed in.'); return; }
      if (p.id === userId) { setError("You can't add yourself."); return; }
      const state = relationshipByUserId[p.id] ?? (await getRelationshipState(userId, p.id));
      if (state !== 'none') {
        setRelationshipByUserId((prev) => ({ ...prev, [p.id]: state }));
        if (state === 'incoming_pending') {
          setError('This person has already sent you a request.');
          setShowGoToRequestsLink(true);
        }
        setAlreadyRequestedIds((prev) => new Set(prev).add(p.id));
        return;
      }
      if (alreadyRequestedIds.has(p.id)) return;
      setAddingId(p.id);
      setError(null);
      setShowGoToRequestsLink(false);
      try {
        const { error: insertError } = await sendFriendRequest(userId, p.id);
        if (insertError) {
          if (insertError.code === 'RELATIONSHIP_EXISTS' || insertError.code === '23505') {
            const newState = await getRelationshipState(userId, p.id);
            setRelationshipByUserId((prev) => ({ ...prev, [p.id]: newState }));
            setAlreadyRequestedIds((prev) => new Set(prev).add(p.id));
            if (newState === 'incoming_pending') {
              setError('This person has already sent you a request.');
              setShowGoToRequestsLink(true);
            } else {
              setError(insertError.message ?? null);
            }
          } else {
            setError(insertError.message ?? String(insertError));
          }
          return;
        }
        setAlreadyRequestedIds((prev) => new Set(prev).add(p.id));
        setRelationshipByUserId((prev) => ({ ...prev, [p.id]: 'outgoing_pending' }));
        Alert.alert('', 'Friend request sent.');
      } catch (e) {
        setError((e as { message?: string })?.message ?? String(e));
      } finally {
        setAddingId(null);
      }
    },
    [userId, alreadyRequestedIds, relationshipByUserId]
  );

  const handleAcceptRequest = useCallback(
    async (profile: ProfileSearchResult) => {
      if (!userId || profile.id === userId) return;
      setAcceptingId(profile.id);
      setError(null);
      try {
        const { error: acceptError } = await acceptFriendRequestByRequesterId(userId, profile.id);
        if (acceptError) {
          setError(acceptError.message ?? 'Accept failed.');
          return;
        }
        setRelationshipByUserId((prev) => ({ ...prev, [profile.id]: 'already_friends' }));
        setAlreadyRequestedIds((prev) => new Set(prev).add(profile.id));
        refreshPendingIncoming();
        Alert.alert('', 'Friend request accepted.');
      } catch (e) {
        setError((e as { message?: string })?.message ?? String(e));
      } finally {
        setAcceptingId(null);
      }
    },
    [userId, refreshPendingIncoming]
  );

  const isEmpty = !query.trim();
  const showEmpty = !loading && isEmpty && results.length === 0;
  const showNoResults = !loading && !isEmpty && results.length === 0;

  const getAddButtonState = (item: ProfileSearchResult) => {
    const state = relationshipByUserId[item.id];
    if (addingId === item.id) return { disabled: true, label: 'Sending...', loading: true, showGoToRequests: false, isAccept: false };
    if (acceptingId === item.id) return { disabled: true, label: 'Accepting...', loading: true, showGoToRequests: false, isAccept: true };
    if (addingId !== null || acceptingId !== null) return { disabled: true, label: 'Add', loading: false, showGoToRequests: false, isAccept: false };
    if (state === 'already_friends' || alreadyRequestedIds.has(item.id)) return { disabled: true, label: 'Friends', showGoToRequests: false, isAccept: false };
    if (state === 'outgoing_pending') return { disabled: true, label: 'Waiting for acceptance', showGoToRequests: false, isAccept: false };
    if (state === 'incoming_pending') return { disabled: false, label: 'Accept request', showGoToRequests: true, isAccept: true };
    return { disabled: false, label: 'Add', loading: false, showGoToRequests: false, isAccept: false };
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.75}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Search Friends</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Enter username"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={(t: string) => { setQuery(t); setError(null); setShowGoToRequestsLink(false); }}
          onSubmitEditing={runSearch}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.searchBtn, loading && styles.buttonDisabled]}
          onPress={runSearch}
          disabled={loading}
          activeOpacity={0.7}
        >
          <Text style={styles.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          {showGoToRequestsLink ? (
            <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/friends/requests')} activeOpacity={0.7}>
              <Text style={styles.linkButtonText}>Go to requests</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.hint}>Searching...</Text>
        </View>
      ) : showEmpty ? (
        <View style={styles.centered}>
          <Text style={styles.hint}>Enter a username and tap Search.</Text>
        </View>
      ) : showNoResults ? (
        <View style={styles.centered}>
          <Text style={styles.hint}>No users found.</Text>
        </View>
      ) : (
        <FlatList<ProfileSearchResult>
          data={results}
          keyExtractor={(item: ProfileSearchResult) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }: { item: ProfileSearchResult }) => {
            const btn = getAddButtonState(item);
            const displayName = item.username ?? item.id.slice(0, 8);
            return (
              <View style={styles.row}>
                <Avatar uri={item.avatar_url ?? null} fallback={displayName} size="md" />
                <Text style={styles.username} numberOfLines={1}>{displayName}</Text>
                {btn.showGoToRequests && btn.isAccept ? (
                  <TouchableOpacity
                    style={[styles.addBtn, btn.disabled && styles.buttonDisabled]}
                    onPress={() => handleAcceptRequest(item)}
                    disabled={btn.disabled}
                    activeOpacity={0.7}
                  >
                    {btn.loading ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.addBtnText}>{btn.label}</Text>}
                  </TouchableOpacity>
                ) : btn.showGoToRequests ? (
                  <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/friends/requests')} activeOpacity={0.7}>
                    <Text style={styles.linkButtonText}>Go to requests</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.addBtn, btn.disabled && styles.buttonDisabled]}
                    onPress={() => handleAdd(item)}
                    disabled={btn.disabled}
                    activeOpacity={0.7}
                  >
                    {btn.loading ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.addBtnText}>{btn.label}</Text>}
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgCardBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  inputRow: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.bgCardBorder,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.textPrimary,
  },
  searchBtn: {
    paddingHorizontal: 16,
    height: 44,
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
  },
  searchBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
  errorBox: { margin: spacing.md, padding: 12, backgroundColor: 'rgba(248,113,113,0.12)', borderRadius: radius.sm },
  errorText: { color: colors.error, fontSize: 14 },
  linkButton: { marginTop: 10, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: radius.sm },
  linkButtonText: { color: colors.bg, fontSize: 14, fontWeight: '600' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  hint: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
  listContent: { padding: spacing.md, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    gap: 12,
  },
  username: { flex: 1, fontSize: 16, color: colors.textPrimary },
  addBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    minWidth: 64,
    alignItems: 'center',
  },
  addBtnText: { color: colors.bg, fontSize: 14, fontWeight: '600' },
});
