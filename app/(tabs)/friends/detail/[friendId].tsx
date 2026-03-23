import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { useFriendRequestsStore } from '@/store/useFriendRequestsStore';
import { getAlias, setAlias } from '@/lib/friendAliases';
import { getFriendStats, getUserStats, type FriendStats, type UserStats } from '@/lib/stats';
import {
  getRelationshipState,
  type RelationshipState,
  acceptFriendRequestByRequesterId,
  declineFriendRequest,
  getPendingRequestIdFromRequester,
  removeFriend,
} from '@/lib/friendRequests';
import { Avatar } from '@/ui/components/Avatar';
import { Card } from '@/ui/components/Card';
import { colors, radius, spacing } from '@/ui/theme';

type Profile = { username: string | null; avatar_url: string | null; bio: string | null };

export default function FriendDetailScreen() {
  const { friendId } = useLocalSearchParams<{ friendId: string }>();
  const router = useRouter();
  const myId = useAuthStore((s) => s.user?.id) ?? null;
  const refreshPendingIncoming = useFriendRequestsStore((s) => s.refreshPendingIncoming);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [relationshipState, setRelationshipState] = useState<RelationshipState | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [alias, setAliasState] = useState<string>('');
  const [aliasSaving, setAliasSaving] = useState(false);
  const [friendStats, setFriendStats] = useState<FriendStats | null>(null);
  const [userGlobalStats, setUserGlobalStats] = useState<UserStats | null>(null);
  const [acceptDeclineLoading, setAcceptDeclineLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!friendId) return;
    setLoading(true);
    try {
      const [profileRes, state, requestId, aliasVal, stats, globalStats] = await Promise.all([
        supabase.from('profiles').select('username, avatar_url, bio').eq('id', friendId).maybeSingle(),
        myId ? getRelationshipState(myId, friendId) : Promise.resolve('none' as RelationshipState),
        myId ? getPendingRequestIdFromRequester(myId, friendId) : Promise.resolve(null),
        getAlias(friendId),
        myId ? getFriendStats(friendId) : Promise.resolve({ messages_total: 0, snaps_total: 0, score_total: 0 }),
        myId ? getUserStats(friendId) : Promise.resolve({ messages_total: 0, snaps_total: 0, score_total: 0 }),
      ]);
      setProfile(profileRes.data as Profile | null);
      setRelationshipState(state);
      setPendingRequestId(requestId);
      setAliasState(aliasVal ?? '');
      setFriendStats(stats);
      setUserGlobalStats(globalStats);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [friendId, myId]);

  useEffect(() => { loadData(); }, [loadData]);

  const saveAlias = async () => {
    if (!friendId) return;
    setAliasSaving(true);
    try {
      await setAlias(friendId, alias || null);
      Alert.alert('Saved', alias.trim() ? `Nickname: ${alias.trim()}` : 'Nickname removed.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setAliasSaving(false);
    }
  };

  const displayName = profile?.username ?? (friendId ? `${friendId.slice(0, 8)}…` : '');

  const handleRemoveFriend = () => {
    if (!myId || !friendId) return;
    Alert.alert(
      'Remove Friend',
      `Remove ${displayName} from your friends? They will no longer see you in their friend list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoveLoading(true);
            const { error } = await removeFriend(myId, friendId);
            setRemoveLoading(false);
            if (error) {
              Alert.alert('Error', error.message ?? 'Could not remove friend.');
              return;
            }
            refreshPendingIncoming();
            setRelationshipState('none');
            router.back();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Friend</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{displayName}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileSection}>
          <Avatar uri={profile?.avatar_url} fallback={displayName} size="lg" />
          <Text style={styles.username}>{displayName}</Text>
          {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        </View>

        {relationshipState === 'incoming_pending' && (
        <Card style={styles.section}>
          <Text style={styles.sectionLabel}>Friend request</Text>
          <View style={styles.acceptDeclineRow}>
            <TouchableOpacity
              style={[styles.acceptBtn, acceptDeclineLoading && styles.acceptDeclineDisabled]}
              onPress={async () => {
                if (!myId || !friendId || acceptDeclineLoading) return;
                setAcceptDeclineLoading(true);
                const { error } = await acceptFriendRequestByRequesterId(myId, friendId);
                setAcceptDeclineLoading(false);
                if (error) {
                  Alert.alert('Error', error.message ?? 'Could not accept.');
                  return;
                }
                refreshPendingIncoming();
                loadData();
              }}
              disabled={acceptDeclineLoading}
              activeOpacity={0.7}
            >
              <Text style={styles.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.declineBtn, acceptDeclineLoading && styles.acceptDeclineDisabled]}
              onPress={async () => {
                if (!pendingRequestId || acceptDeclineLoading) return;
                setAcceptDeclineLoading(true);
                const { error } = await declineFriendRequest(pendingRequestId);
                setAcceptDeclineLoading(false);
                if (error) {
                  Alert.alert('Error', error.message ?? 'Could not decline.');
                  return;
                }
                refreshPendingIncoming();
                loadData();
              }}
              disabled={acceptDeclineLoading}
              activeOpacity={0.7}
            >
              <Text style={styles.declineBtnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {relationshipState === 'already_friends' && (
        <>
          <Card style={styles.section}>
            <Text style={styles.sectionLabel}>Nickname</Text>
            <View style={styles.aliasRow}>
              <TextInput
                style={styles.aliasInput}
                value={alias}
                onChangeText={setAliasState}
                placeholder="Set nickname…"
                placeholderTextColor={colors.textMuted}
                maxLength={60}
              />
              <TouchableOpacity
                style={[styles.saveBtn, aliasSaving && styles.saveBtnDisabled]}
                onPress={saveAlias}
                disabled={aliasSaving}
                activeOpacity={0.7}
              >
                {aliasSaving ? (
                  <ActivityIndicator size="small" color={colors.bg} />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </Card>

          {userGlobalStats && (
            <Card style={styles.section}>
              <Text style={styles.sectionLabel}>Their global score</Text>
              <Text style={styles.metaText}>Messages (all): {userGlobalStats.messages_total}</Text>
              <Text style={styles.metaText}>Snaps (all): {userGlobalStats.snaps_total}</Text>
              <Text style={styles.msgCount}>{userGlobalStats.score_total}</Text>
            </Card>
          )}

          <Card style={styles.section}>
            <Text style={styles.sectionLabel}>With you</Text>
            <Text style={styles.metaText}>Messages exchanged: {friendStats ? friendStats.messages_total : '…'}</Text>
            <Text style={styles.metaText}>Snaps exchanged: {friendStats ? friendStats.snaps_total : '…'}</Text>
            <Text style={styles.msgCount}>Score: {friendStats ? friendStats.score_total : '…'}</Text>
          </Card>

          <TouchableOpacity
            style={[styles.removeBtn, removeLoading && styles.removeBtnDisabled]}
            onPress={handleRemoveFriend}
            disabled={removeLoading}
            activeOpacity={0.7}
          >
            {removeLoading ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Text style={styles.removeBtnText}>Remove Friend</Text>
            )}
          </TouchableOpacity>
        </>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
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
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileSection: { alignItems: 'center', paddingTop: 32, paddingBottom: 24 },
  username: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginTop: 12 },
  bio: { fontSize: 14, color: colors.textSecondary, marginTop: 6, textAlign: 'center', paddingHorizontal: 24 },
  section: { marginHorizontal: spacing.md, marginBottom: spacing.md },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  metaText: { fontSize: 14, color: colors.textSecondary, marginBottom: 4 },
  aliasRow: { flexDirection: 'row', gap: 10 },
  aliasInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 14, fontWeight: '600', color: colors.bg },
  msgCount: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  acceptDeclineRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  acceptBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  acceptDeclineDisabled: { opacity: 0.6 },
  acceptBtnText: { fontSize: 15, fontWeight: '600', color: colors.bg },
  declineBtnText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  removeBtn: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.error,
  },
  removeBtnDisabled: { opacity: 0.6 },
  removeBtnText: { fontSize: 15, fontWeight: '600', color: colors.error },
});
