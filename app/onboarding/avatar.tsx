import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase, getUpdateClient } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import type { Database } from '@/types/database';
import { BackgroundDecor } from '@/ui/components/BackgroundDecor';
import { AppButton } from '@/ui/components/AppButton';
import { Avatar } from '@/ui/components/Avatar';
import { Card } from '@/ui/components/Card';
import { colors, spacing, typography } from '@/ui/theme';

const AVATARS_BUCKET = 'avatars';
const MAX_AVATAR_WIDTH = 512;
const AVATAR_QUALITY = 0.7;
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
const profilesUpdateClient = getUpdateClient<ProfileUpdate>('profiles');

function base64ToUint8Array(b64: string): Uint8Array {
  const raw = b64.replace(/^data:image\/\w+;base64,/, '').trim();
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default function OnboardingAvatarScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadFromUri(uri: string) {
    if (!userId) return;
    setUploading(true);
    setError(null);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: MAX_AVATAR_WIDTH } }],
        { compress: AVATAR_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) throw new Error('Image processing failed.');
      const bytes = base64ToUint8Array(manipulated.base64);
      const path = `${userId}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(AVATARS_BUCKET)
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const avatarUpdate: ProfileUpdate = { avatar_url: publicUrl };
      const { error: profileUpdateError } = await profilesUpdateClient.update(avatarUpdate).eq('id', userId);
      if (profileUpdateError) throw profileUpdateError;
      setAvatarUrl(publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function pickFromLibrary() {
    if (!userId || uploading) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    await uploadFromUri(result.assets[0].uri);
  }

  async function takePhoto() {
    if (!userId || uploading) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission is required to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    await uploadFromUri(result.assets[0].uri);
  }

  function showAvatarSourcePicker() {
    Alert.alert('Profile picture', 'Choose a source', [
      { text: 'Choose from library', onPress: pickFromLibrary },
      { text: 'Take photo', onPress: takePhoto },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleFinish() {
    if (!userId) return;
    try {
      const onboardingUpdate: ProfileUpdate = { onboarding_completed: true };
      await profilesUpdateClient.update(onboardingUpdate).eq('id', userId);
    } catch {
      // best-effort
    }
    router.replace('/');
  }

  return (
    <View style={styles.container}>
      <BackgroundDecor />
      <View style={styles.content}>
        <Text style={styles.step}>Step 2 / 2</Text>
        <Text style={styles.title}>Choose the face of your profile</Text>
        <Text style={styles.subtitle}>A strong avatar makes chats, snaps and your friends list feel instantly alive.</Text>

        <Card style={styles.card}>
          <View style={styles.avatarBlock}>
            <Avatar uri={avatarUrl} fallback="?" size="lg" />
            <Text style={styles.avatarHint}>{avatarUrl ? 'You can still swap this later in settings.' : 'Pick a photo or keep it minimal for now.'}</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <AppButton
            label={uploading ? 'Uploading...' : 'Choose from library'}
            onPress={showAvatarSourcePicker}
            loading={uploading}
            disabled={uploading}
            icon="image-outline"
          />
          <AppButton
            label="Finish setup"
            onPress={handleFinish}
            variant="secondary"
            style={styles.secondaryAction}
            icon="checkmark-outline"
          />
          {!avatarUrl ? (
            <AppButton
              label="Skip for now"
              onPress={handleFinish}
              variant="ghost"
              disabled={uploading}
              style={styles.skipButton}
            />
          ) : null}
          {uploading ? <ActivityIndicator style={styles.hiddenSpinner} color={colors.accent} /> : null}
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  step: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.accentSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.hero,
    fontSize: 34,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    marginBottom: spacing.xl,
    maxWidth: 320,
  },
  card: {
    padding: spacing.xl,
  },
  avatarBlock: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatarHint: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.md,
    maxWidth: 240,
  },
  error: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  secondaryAction: {
    marginTop: spacing.sm,
  },
  skipButton: {
    marginTop: spacing.xs,
  },
  hiddenSpinner: {
    height: 0,
    opacity: 0,
  },
});
