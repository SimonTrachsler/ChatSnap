import { useState } from 'react';
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getUpdateClient } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import type { Database } from '@/types/database';
import { BackgroundDecor } from '@/ui/components/BackgroundDecor';
import { AppButton } from '@/ui/components/AppButton';
import { AppTextField } from '@/ui/components/AppTextField';
import { Card } from '@/ui/components/Card';
import { colors, spacing, typography } from '@/ui/theme';

const MAX_BIO_LENGTH = 200;
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
const profilesUpdateClient = getUpdateClient<ProfileUpdate>('profiles');

export default function OnboardingBioScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleNext() {
    if (!userId) return;
    const trimmed = bio.trim();
    if (trimmed) {
      setSaving(true);
      setError(null);
      try {
        const bioUpdate: ProfileUpdate = { bio: trimmed };
        const { error: err } = await profilesUpdateClient.update(bioUpdate).eq('id', userId);
        if (err) throw err;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    router.replace('/onboarding/avatar');
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <BackgroundDecor />
      <View style={styles.content}>
        <Text style={styles.step}>Step 1 / 2</Text>
        <Text style={styles.title}>Give your profile a voice</Text>
        <Text style={styles.subtitle}>A short line makes the app feel more personal from the first chat onward.</Text>

        <Card style={styles.card}>
          <AppTextField
            label="About you"
            value={bio}
            onChangeText={setBio}
            placeholder="What do your friends notice about you first?"
            multiline
            maxLength={MAX_BIO_LENGTH}
            editable={!saving}
            error={error}
            helper={`${bio.length}/${MAX_BIO_LENGTH}`}
          />
          <AppButton
            label={saving ? 'Saving...' : 'Continue'}
            onPress={handleNext}
            disabled={saving}
            loading={saving}
            icon="arrow-forward-outline"
          />
          <AppButton
            label="Skip for now"
            onPress={() => router.replace('/onboarding/avatar')}
            disabled={saving}
            variant="ghost"
            style={styles.skipButton}
          />
        </Card>
      </View>
    </KeyboardAvoidingView>
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
  skipButton: {
    marginTop: spacing.xs,
  },
});
