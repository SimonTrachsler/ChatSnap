import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase, getUpdateClient } from '@/lib/supabase';
import { invalidateThreadsCache } from '@/lib/chat';
import { useAuthStore } from '@/store/useAuthStore';
import { useActiveThreadStore } from '@/store/useActiveThreadStore';
import { getMyStats, type MyStats } from '@/lib/stats';
import type { Database } from '@/types/database';
import { AppButton } from '@/ui/components/AppButton';
import { AppTextField } from '@/ui/components/AppTextField';
import { Avatar } from '@/ui/components/Avatar';
import { Card } from '@/ui/components/Card';
import { PageHeader } from '@/ui/components/PageHeader';
import { colors, radius, spacing } from '@/ui/theme';

const AVATARS_BUCKET = 'avatars';
const MAX_AVATAR_WIDTH = 512;
const AVATAR_QUALITY = 0.8;
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
type DeleteAccountResult = {
  success?: boolean;
  error?: string | { message?: string | null } | null;
} | null;
type FunctionsHttpErrorLike = {
  name?: string;
  context?: {
    json?: () => Promise<unknown>;
  };
};
const profilesUpdateClient = getUpdateClient<ProfileUpdate>('profiles');

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  const raw = b64.replace(/^data:image\/\w+;base64,/, '').trim();
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getDeleteAccountErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const errorValue = (value as { error?: unknown }).error;
  if (typeof errorValue === 'string') return errorValue;
  if (errorValue && typeof errorValue === 'object') {
    const message = (errorValue as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}

async function cleanupLocalSessionState(): Promise<void> {
  invalidateThreadsCache();
  useActiveThreadStore.getState().setActiveThreadId(null);
  try {
    await supabase.removeAllChannels();
  } catch {
    // ignore channel cleanup failures
  }
}

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [myStats, setMyStats] = useState<MyStats | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace('/welcome');
  }, [authLoading, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchUserAndProfile() {
      setLoading(true);
      try {
        const { data: authResult, error: authError } = await supabase.auth.getUser();
        if (cancelled) return;

        const authUser = authResult.user;
        if (authError || !authUser) {
          setUsername('');
          setBio('');
          setEmail(null);
          setCreatedAt(null);
          setAvatarUrl(null);
          setMyStats(null);
          return;
        }

        setEmail(authUser.email ?? null);
        setCreatedAt(authUser.created_at ?? null);

        const [profileResult, statsResult] = await Promise.allSettled([
          supabase.from('profiles').select('username, avatar_url, bio').eq('id', authUser.id).maybeSingle(),
          getMyStats(),
        ]);
        if (cancelled) return;

        if (profileResult.status === 'fulfilled') {
          const row = profileResult.value.data as { username?: string | null; avatar_url?: string | null; bio?: string | null } | null;
          setUsername(row?.username ?? '');
          setAvatarUrl(row?.avatar_url ?? null);
          setBio(row?.bio ?? '');
        } else {
          setUsername('');
          setAvatarUrl(null);
          setBio('');
        }

        setMyStats(statsResult.status === 'fulfilled' ? (statsResult.value ?? null) : null);
      } catch {
        if (cancelled) return;
        setUsername('');
        setBio('');
        setEmail(null);
        setCreatedAt(null);
        setAvatarUrl(null);
        setMyStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchUserAndProfile();
    return () => { cancelled = true; };
  }, [user]);

  if (authLoading || !user || loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  async function handleSaveProfile() {
    if (!user) return;
    setProfileSaving(true);
    try {
      const updates: ProfileUpdate = {};
      const trimmedUsername = username.trim();
      const trimmedBio = bio.trim();
      if (trimmedUsername) updates.username = trimmedUsername;
      updates.bio = trimmedBio || null;
      const { error: err } = await profilesUpdateClient.update(updates).eq('id', user.id);
      if (err) throw err;
      Alert.alert('Saved', 'Profile updated.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      useAuthStore.getState().setAuth(null);
    }
    await cleanupLocalSessionState();
    router.replace('/welcome');
  }

  async function uploadAvatarFromUri(uri: string) {
    if (!user) return;
    setAvatarUploading(true);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: MAX_AVATAR_WIDTH } }],
        { compress: AVATAR_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) throw new Error('Image processing failed.');
      const bytes = base64ToUint8Array(manipulated.base64);
      const path = `${user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage.from(AVATARS_BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const avatarUpdate: ProfileUpdate = { avatar_url: publicUrl };
      const { error: updateError } = await profilesUpdateClient.update(avatarUpdate).eq('id', user.id);
      if (updateError) throw updateError;
      setAvatarUrl(publicUrl);
      Alert.alert('Success', 'Profile picture updated.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function pickAndUploadAvatar() {
    if (avatarUploading) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    await uploadAvatarFromUri(result.assets[0].uri);
  }

  async function handleDeleteAccount() {
    if (!deletePassword.trim()) {
      Alert.alert('Error', 'Please enter your password.');
      return;
    }
    setDeleteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<DeleteAccountResult>('delete-account', {
        body: { password: deletePassword },
      });
      if (error) {
        const errName = (error as FunctionsHttpErrorLike).name ?? '';
        if (errName === 'FunctionsHttpError') {
          let detail = 'Server error. Please try again later.';
          try {
            const body = await (error as FunctionsHttpErrorLike).context?.json?.();
            const bodyMessage = getDeleteAccountErrorMessage(body);
            if (bodyMessage) detail = bodyMessage;
          } catch {
            // ignore parse failure
          }
          if (detail.toLowerCase().includes('wrong password')) setDeletePassword('');
          Alert.alert('Error', detail);
          return;
        }
        if (errName === 'FunctionsRelayError' || errName === 'FunctionsFetchError') {
          Alert.alert('Error', 'Server not reachable. Please try again later.');
          return;
        }
        throw error;
      }
      if (data == null) {
        Alert.alert('Error', 'Delete service unavailable.');
        return;
      }
      if (data?.success === true) {
        setDeleteModalVisible(false);
        setDeletePassword('');
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          useAuthStore.getState().setAuth(null);
        }
        await cleanupLocalSessionState();
        router.replace('/welcome');
        return;
      }
      const errMsg = typeof data?.error === 'string' ? data.error : data?.error?.message ?? 'Delete failed.';
      if (errMsg.toLowerCase().includes('wrong password')) setDeletePassword('');
      Alert.alert('Error', errMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete account failed.';
      Alert.alert('Error', msg);
    } finally {
      setDeleteLoading(false);
    }
  }

  const displayName = username || email || '?';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <PageHeader title="Settings" />

        <Card style={styles.heroCard}>
          <View style={styles.avatarSection}>
            <Avatar uri={avatarUrl} fallback={displayName} size="lg" />
            <Text style={styles.displayName}>{displayName}</Text>
            <Text style={styles.avatarHint}>Tap below to refresh your portrait.</Text>
          </View>
          <AppButton
            label={avatarUploading ? 'Uploading...' : 'Change avatar'}
            onPress={pickAndUploadAvatar}
            loading={avatarUploading}
            disabled={avatarUploading}
            icon="image-outline"
          />
        </Card>

        <Card style={styles.cardSpacing}>
          <AppTextField
            label="Username"
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={40}
          />
          <AppTextField
            label="Bio"
            value={bio}
            onChangeText={setBio}
            placeholder="Tell people a little about your vibe..."
            multiline
            maxLength={200}
            helper={`${bio.length}/200`}
          />
          <AppButton
            label={profileSaving ? 'Saving...' : 'Save profile'}
            onPress={handleSaveProfile}
            disabled={profileSaving}
            loading={profileSaving}
            icon="save-outline"
          />
        </Card>

        {myStats !== null ? (
          <Card style={styles.cardSpacing}>
            <Text style={styles.sectionTitle}>Your stats</Text>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Messages</Text>
              <Text style={styles.statValue}>{myStats.messages_total}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Snaps</Text>
              <Text style={styles.statValue}>{myStats.snaps_total}</Text>
            </View>
            <View style={[styles.statRow, styles.statRowLast]}>
              <Text style={styles.statLabel}>Score</Text>
              <Text style={styles.statValue}>{myStats.score_total}</Text>
            </View>
          </Card>
        ) : null}

        <Card style={styles.cardSpacing}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Email</Text>
            <Text style={styles.statValue}>{email ?? '-'}</Text>
          </View>
          <View style={[styles.statRow, styles.statRowLast]}>
            <Text style={styles.statLabel}>Created</Text>
            <Text style={styles.statValue}>{formatDate(createdAt)}</Text>
          </View>
        </Card>

        <AppButton label="Log out" onPress={handleLogout} variant="secondary" icon="log-out-outline" style={styles.cardSpacing} />
        <AppButton label="Delete account" onPress={() => setDeleteModalVisible(true)} variant="danger" icon="trash-outline" />
      </ScrollView>

      <Modal visible={deleteModalVisible} transparent animationType="fade" onRequestClose={() => setDeleteModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <Card style={styles.modalContent}>
            <Text style={styles.modalTitle}>Delete account</Text>
            <Text style={styles.modalSubtitle}>This action cannot be undone. All snaps, chats and photos will be permanently removed.</Text>
            <AppTextField
              key="delete-account-password"
              label="Confirm password"
              value={deletePassword}
              onChangeText={setDeletePassword}
              placeholder="Password"
              secureTextEntry
              autoCapitalize="none"
              editable={!deleteLoading}
            />
            <View style={styles.modalActions}>
              <AppButton
                label="Cancel"
                onPress={() => {
                  setDeleteModalVisible(false);
                  setDeletePassword('');
                }}
                disabled={deleteLoading}
                variant="secondary"
                style={styles.modalButton}
              />
              <AppButton
                label={deleteLoading ? 'Deleting...' : 'Delete'}
                onPress={handleDeleteAccount}
                disabled={deleteLoading}
                loading={deleteLoading}
                variant="danger"
                style={styles.modalButton}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
  loadingText: { marginTop: 12, fontSize: 15, color: colors.textMuted },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: 140 },
  heroCard: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  displayName: {
    marginTop: spacing.md,
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  avatarHint: {
    marginTop: spacing.xs,
    fontSize: 13,
    color: colors.textMuted,
  },
  cardSpacing: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.accentSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  statRowLast: { borderBottomWidth: 0 },
  statLabel: { fontSize: 14, color: colors.textMuted },
  statValue: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    padding: spacing.xl,
    borderRadius: radius.lg,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  modalSubtitle: { fontSize: 14, color: colors.textSecondary, lineHeight: 21, marginBottom: spacing.lg },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
  modalButton: { flex: 1 },
});
