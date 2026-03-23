/**
 * Manual test checklist (auth):
 * 1) Register with short password -> error
 * 2) Register valid -> success message
 * 3) Login with wrong password -> error
 * 4) Login with correct username -> navigates to home
 * 5) Restart app -> stays logged in
 */
import { useState } from 'react';
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { signInWithIdentifier } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { LoadingScreen } from '@/components/LoadingScreen';
import { BackgroundDecor } from '@/ui/components/BackgroundDecor';
import { AppButton } from '@/ui/components/AppButton';
import { AppTextField } from '@/ui/components/AppTextField';
import { Card } from '@/ui/components/Card';
import { colors, spacing, typography } from '@/ui/theme';

function formatLoginError(raw: string, status?: number): string {
  const lower = raw.toLowerCase();
  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Log in failed. Email/username or password is incorrect.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Email is not confirmed yet.';
  }
  if (lower.includes('benutzername nicht gefunden') || lower.includes('username not found')) {
    return 'Username not found.';
  }
  if (lower.includes('user not found') || lower.includes('benutzer nicht gefunden')) {
    return 'User not found.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Network error. Please check your connection.';
  }
  return raw;
}

export default function LoginScreen() {
  const user = useAuthStore((s) => s.user);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin() {
    if (isSubmitting) return;
    setError(null);
    const trimmed = identifier.trim();
    if (!trimmed || !password) {
      setError('Enter email or username and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      await signInWithIdentifier(trimmed, password);
      router.replace('/');
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string } | null;
      const status = err?.status;
      const raw =
        typeof err?.message === 'string'
          ? err.message
          : e instanceof Error
            ? e.message
            : 'Log in failed.';
      const friendly = formatLoginError(raw, status);
      setError(friendly);
      const rawLower = raw.toLowerCase();
      if (rawLower.includes('invalid login') || rawLower.includes('invalid credentials')) {
        setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user) {
    return <LoadingScreen message="Redirecting..." />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <BackgroundDecor />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Welcome back</Text>
          <Text style={styles.title}>Log in to your night feed</Text>
          <Text style={styles.subtitle}>Pick up your chats, gallery and camera in one smooth flow.</Text>
        </View>

        <Card style={styles.formCard}>
          <AppTextField
            label="Email or username"
            value={identifier}
            onChangeText={(t: string) => {
              setIdentifier(t);
              setError(null);
            }}
            placeholder="Email or username"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSubmitting}
          />

          <AppTextField
            label="Password"
            key="login-password"
            value={password}
            onChangeText={(t: string) => {
              setPassword(t);
              setError(null);
            }}
            placeholder="Your password"
            secureTextEntry
            editable={!isSubmitting}
            error={error}
          />

          <AppButton
            label={isSubmitting ? 'Logging in...' : 'Log in'}
            onPress={handleLogin}
            disabled={!identifier.trim() || !password || isSubmitting}
            loading={isSubmitting}
            icon="arrow-forward-outline"
          />
          <AppButton
            label="Create account"
            onPress={() => router.push('/register')}
            disabled={isSubmitting}
            variant="ghost"
            style={styles.linkButton}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  hero: {
    marginBottom: spacing.xl,
  },
  eyebrow: {
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
    maxWidth: 320,
  },
  formCard: {
    padding: spacing.xl,
  },
  linkButton: {
    marginTop: spacing.xs,
  },
});
