import { useCallback, useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/useAuthStore';
import { useFriendRequestsStore } from '@/store/useFriendRequestsStore';
import { getDiscoverUsers, type DiscoverUser } from '@/lib/discover';
import { searchProfiles, type ProfileSearchResult } from '@/lib/profileSearch';
import {
  getRelationshipState,
  getRelationshipStates,
  type RelationshipState,
  sendFriendRequest,
  acceptFriendRequestByRequesterId,
} from '@/lib/friendRequests';
import { Avatar } from '@/ui/components/Avatar';
import { colors, radius, spacing } from '@/ui/theme';

const DISCOVER_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

type DisplayUser = { id: string; username: string | null; avatar_url: string | null };

function normalizeDisplayUsers<T extends DisplayUser>(users: T[], currentUserId: string | null): T[] {
  return users.filter((user): user is T => {
    return Boolean(user?.id) && user.id !== currentUserId;
  });
}

function shouldShowDiscoverUser(state: RelationshipState | undefined): boolean {
  return state !== 'already_friends' && state !== 'outgoing_pending';
}

export default function DiscoverScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const refreshPendingIncoming = useFriendRequestsStore((s) => s.refreshPendingIncoming);

  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<DiscoverUser[]>([]);
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [relationshipByUserId, setRelationshipByUserId] = useState<Record<string, RelationshipState>>({});
  const [addingId, setAddingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDiscover = useCallback(async () => {
    if (!userId) {
      setUsers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = normalizeDisplayUsers(await getDiscoverUsers(DISCOVER_LIMIT, userId), userId);
      const states = await getRelationshipStates(userId, list.map((u) => u.id));
      const filteredList = list.filter((user) => shouldShowDiscoverUser(states[user.id])).slice(0, DISCOVER_LIMIT);
      setUsers(filteredList);
      setRelationshipByUserId((prev) => ({ ...prev, ...states }));
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Failed to load users.');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadDiscover();
  }, [loadDiscover]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      searchDebounceRef.current = null;
      if (!userId) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }
      try {
        const list = await searchProfiles(q);
        const filtered = normalizeDisplayUsers(list, userId);
        setSearchResults(filtered);
        const states = await getRelationshipStates(userId, filtered.map((r) => r.id));
        setRelationshipByUserId((prev) => ({ ...prev, ...states }));
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, userId]);

  const handleAdd = useCallback(
    async (user: DiscoverUser) => {
      if (!userId || user.id === userId) return;
      const state = relationshipByUserId[user.id] ?? (await getRelationshipState(userId, user.id));
      if (state !== 'none') {
        setRelationshipByUserId((prev) => ({ ...prev, [user.id]: state }));
        return;
      }
      setAddingId(user.id);
      setError(null);
      try {
        const { error: insertError } = await sendFriendRequest(userId, user.id);
        if (insertError) {
          const newState = await getRelationshipState(userId, user.id);
          setRelationshipByUserId((prev) => ({ ...prev, [user.id]: newState }));
          setError(insertError.message ?? 'Could not send request.');
          return;
        }
        setRelationshipByUserId((prev) => ({ ...prev, [user.id]: 'outgoing_pending' }));
        Alert.alert('', 'Friend request sent.');
      } catch (e) {
        setError((e as { message?: string })?.message ?? String(e));
      } finally {
        setAddingId(null);
      }
    },
    [userId, relationshipByUserId]
  );

  const handleAcceptRequest = useCallback(
    async (user: DiscoverUser) => {
      if (!userId || user.id === userId) return;
      setAcceptingId(user.id);
      setError(null);
      try {
        const { error: acceptError } = await acceptFriendRequestByRequesterId(userId, user.id);
        if (acceptError) {
          setError(acceptError.message ?? 'Accept failed.');
          return;
        }
        setRelationshipByUserId((prev) => ({ ...prev, [user.id]: 'already_friends' }));
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

  const getAddButtonState = (item: DisplayUser) => {
    const state = relationshipByUserId[item.id];
    if (addingId === item.id) return { disabled: true, label: 'Sending…', loading: true, isAccept: false };
    if (acceptingId === item.id) return { disabled: true, label: 'Accepting…', loading: true, isAccept: true };
    if (addingId !== null || acceptingId !== null) return { disabled: true, label: 'Add', loading: false, isAccept: false };
    if (state === 'already_friends') return { disabled: true, label: 'Friends', loading: false, isAccept: false };
    if (state === 'outgoing_pending') return { disabled: true, label: 'Request sent', loading: false, isAccept: false };
    if (state === 'incoming_pending') return { disabled: false, label: 'Incoming request', loading: false, isAccept: true };
    return { disabled: false, label: 'Add', loading: false, isAccept: false };
  };

  const renderUserRow = (item: DisplayUser) => {
    const btn = getAddButtonState(item);
    const displayName = item.username ?? item.id.slice(0, 8);
    const userForActions = { id: item.id, username: item.username, avatar_url: item.avatar_url };
    return (
      <View style={styles.row} key={item.id}>
        <Avatar uri={item.avatar_url} fallback={displayName} size="md" />
        <Text style={styles.username} numberOfLines={1}>{displayName}</Text>
        {btn.isAccept ? (
          <TouchableOpacity
            style={[styles.addBtn, btn.disabled && styles.buttonDisabled]}
            onPress={() => handleAcceptRequest(userForActions)}
            disabled={btn.disabled}
            activeOpacity={0.7}
          >
            {btn.loading ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.addBtnText}>{btn.label}</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.addBtn, btn.disabled && styles.buttonDisabled]}
            onPress={() => handleAdd(userForActions)}
            disabled={btn.disabled}
            activeOpacity={0.7}
          >
            {btn.loading ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.addBtnText}>{btn.label}</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const suggestionIds = new Set(users.map((u) => u.id));
  const dedupedSearch = searchResults.filter((u) => !suggestionIds.has(u.id));

  const sections: { title: string; data: DisplayUser[] }[] = [];
  if (searchQuery.trim()) {
    if (dedupedSearch.length > 0 || searchLoading) {
      sections.push({
        title: searchLoading ? 'Search results…' : 'Search results',
        data: dedupedSearch,
      });
    }
    if (users.length > 0) {
      sections.push({ title: 'Suggestions', data: users });
    }
  } else if (users.length > 0) {
    sections.push({ title: 'Suggestions', data: users });
  }
  const showInitialEmpty = !searchQuery.trim() && !loading && users.length === 0;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Discover</Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={loadDiscover} disabled={loading} activeOpacity={0.7}>
          <Ionicons name="refresh" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by username"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading && users.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.hint}>Loading…</Text>
        </View>
      ) : showInitialEmpty ? (
        <View style={styles.centered}>
          <Text style={styles.hint}>No suggestions right now. Try search or refresh later.</Text>
        </View>
      ) : sections.length === 0 && searchLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.hint}>Searching…</Text>
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.hint}>{`No results for "${searchQuery.trim()}".`}</Text>
        </View>
      ) : (
        <SectionList<DisplayUser>
          sections={sections}
          keyExtractor={(item: DisplayUser) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }: { section: { title: string } }) => (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          )}
          renderItem={({ item }: { item: DisplayUser }) => renderUserRow(item)}
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
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgCardBorder,
  },
  backBtn: { padding: 8, marginRight: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
  refreshBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
  },
  clearBtn: { padding: 4 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  errorBox: { margin: spacing.md, padding: 12, backgroundColor: 'rgba(248,113,113,0.12)', borderRadius: radius.sm },
  errorText: { color: colors.error, fontSize: 14 },
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
  buttonDisabled: { opacity: 0.5 },
});
