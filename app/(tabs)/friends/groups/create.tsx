import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { listFriends, type FriendListItem } from '@/lib/friendRequests';
import { createGroupThread } from '@/lib/socialFeatures';
import { supabase } from '@/lib/supabase';
import { supabaseErrorToUserMessage } from '@/lib/supabaseErrors';
import { useAuthStore } from '@/store/useAuthStore';
import { Avatar } from '@/ui/components/Avatar';
import { AppButton } from '@/ui/components/AppButton';
import { AppTextField } from '@/ui/components/AppTextField';
import { PageHeader } from '@/ui/components/PageHeader';
import { Card } from '@/ui/components/Card';
import { colors, spacing } from '@/ui/theme';

const AVATARS_BUCKET = 'avatars';
const MAX_GROUP_AVATAR_WIDTH = 720;
const GROUP_AVATAR_QUALITY = 0.82;

function base64ToUint8Array(b64: string): Uint8Array {
  const raw = b64.replace(/^data:image\/\w+;base64,/, '').trim();
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getFriendDisplayName(friend: FriendListItem): string {
  return friend.username ?? friend.email ?? `${friend.id.slice(0, 8)}...`;
}

async function uploadGroupAvatarFromUri(ownerId: string, uri: string): Promise<string> {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_GROUP_AVATAR_WIDTH } }],
    { compress: GROUP_AVATAR_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );

  if (!manipulated.base64) throw new Error('Image processing failed.');

  const bytes = base64ToUint8Array(manipulated.base64);
  const path = `${ownerId}/group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export default function CreateGroupScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id) ?? null;

  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const selectedIdSet = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds]);

  const loadFriends = useCallback(async (showRefreshing = false) => {
    if (!userId) {
      setFriends([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (showRefreshing) setRefreshing(true);
    else setLoading(true);

    try {
      const { data } = await listFriends(userId);
      setFriends((data as FriendListItem[] | null) ?? []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  const toggleMember = useCallback((friendId: string) => {
    setSelectedMemberIds((prev) => {
      if (prev.includes(friendId)) return prev.filter((id) => id !== friendId);
      return [...prev, friendId];
    });
  }, []);

  const pickFromLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setAvatarUri(result.assets[0].uri);
  }, []);

  const pickFromCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera permission is required to take a group picture.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setAvatarUri(result.assets[0].uri);
  }, []);

  const chooseAvatar = useCallback(() => {
    Alert.alert('Group picture', 'Choose a source', [
      { text: 'Library', onPress: pickFromLibrary },
      { text: 'Camera', onPress: pickFromCamera },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [pickFromCamera, pickFromLibrary]);

  const handleCreateGroup = useCallback(async () => {
    if (!userId || creating) return;

    const title = groupName.trim();
    if (!title) {
      Alert.alert('Missing name', 'Please enter a group name.');
      return;
    }
    if (selectedMemberIds.length === 0) {
      Alert.alert('No members', 'Please select at least one friend.');
      return;
    }

    setCreating(true);
    try {
      const avatarUrl = avatarUri ? await uploadGroupAvatarFromUri(userId, avatarUri) : null;
      const groupId = await createGroupThread(title, selectedMemberIds, avatarUrl);
      router.replace(`/(tabs)/inbox/group/${groupId}`);
    } catch (error) {
      Alert.alert('Error', supabaseErrorToUserMessage(error));
    } finally {
      setCreating(false);
    }
  }, [avatarUri, creating, groupName, router, selectedMemberIds, userId]);

  return (
    <View style={styles.container}>
      <FlatList
        data={friends}
        keyExtractor={(item: FriendListItem) => item.id}
        renderItem={({ item }: { item: FriendListItem }) => {
          const displayName = getFriendDisplayName(item);
          const selected = selectedIdSet.has(item.id);
          return (
            <TouchableOpacity style={styles.friendTouch} onPress={() => toggleMember(item.id)} activeOpacity={0.85}>
              <Card style={styles.friendRow}>
                <Avatar uri={item.avatar_url} fallback={displayName} size="md" />
                <View style={styles.friendCopy}>
                  <Text style={styles.friendName} numberOfLines={1}>{displayName}</Text>
                  <Text style={styles.friendMeta} numberOfLines={1}>{item.email ?? 'Friend'}</Text>
                </View>
                <View style={[styles.checkbox, selected && styles.checkboxOn]}>
                  {selected ? <Ionicons name="checkmark" size={16} color={colors.onAccent} /> : null}
                </View>
              </Card>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFriends(true)} tintColor={colors.accent} />}
        ListHeaderComponent={(
          <View>
            <PageHeader
              title="Create Group"
              left={(
                <TouchableOpacity style={styles.headerBackBtn} onPress={() => router.back()} activeOpacity={0.8}>
                  <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              )}
            />

            <Card style={styles.groupConfigCard}>
              <View style={styles.groupAvatarRow}>
                <Avatar uri={avatarUri} fallback={groupName.trim() || 'G'} size="lg" />
                <View style={styles.groupAvatarCopy}>
                  <Text style={styles.groupAvatarTitle}>Group picture</Text>
                  <Text style={styles.groupAvatarSubtitle}>Optional but recommended</Text>
                </View>
                <TouchableOpacity style={styles.groupAvatarButton} onPress={chooseAvatar} activeOpacity={0.82}>
                  <Ionicons name="camera-outline" size={18} color={colors.accentSecondary} />
                </TouchableOpacity>
              </View>

              <AppTextField
                label="Group name"
                value={groupName}
                onChangeText={setGroupName}
                placeholder="e.g. Weekend Squad"
                maxLength={40}
                autoCorrect={false}
              />

              <Text style={styles.memberCounter}>{selectedMemberIds.length} selected</Text>
            </Card>

            <Text style={styles.sectionTitle}>Select members</Text>
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No friends available</Text>
              <Text style={styles.emptySubtitle}>Add friends first, then create your first group.</Text>
              <AppButton
                label="Reload"
                variant="secondary"
                onPress={() => loadFriends(true)}
                icon="refresh-outline"
              />
            </Card>
          )
        }
        ListFooterComponent={
          <View style={styles.footerWrap}>
            <AppButton
              label={creating ? 'Creating...' : 'Create group'}
              onPress={handleCreateGroup}
              disabled={creating || selectedMemberIds.length === 0 || !groupName.trim()}
              loading={creating}
              icon="people-outline"
            />
            <View style={styles.bottomGap} />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 20,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    backgroundColor: colors.bgCardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupConfigCard: {
    marginBottom: spacing.md,
  },
  groupAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: spacing.md,
  },
  groupAvatarCopy: { flex: 1, minWidth: 0 },
  groupAvatarTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  groupAvatarSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  groupAvatarButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.28)',
    backgroundColor: 'rgba(125,211,252,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberCounter: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accentSecondary,
    marginTop: -4,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  friendTouch: {
    marginBottom: spacing.sm,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  friendCopy: {
    flex: 1,
    minWidth: 0,
  },
  friendName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 3,
  },
  friendMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    backgroundColor: colors.bgCardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  loadingWrap: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  footerWrap: {
    marginTop: spacing.md,
  },
  bottomGap: {
    height: 120,
  },
});
