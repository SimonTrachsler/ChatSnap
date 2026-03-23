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
import { supabase, getUpdateClient } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { LoadingScreen } from '@/components/LoadingScreen';
import type { Database } from '@/types/database';
import { BackgroundDecor } from '@/ui/components/BackgroundDecor';
import { AppButton } from '@/ui/components/AppButton';
import { AppTextField } from '@/ui/components/AppTextField';
import { Card } from '@/ui/components/Card';
import { colors, spacing, typography } from '@/ui/theme';

const MIN_PASSWORD_LENGTH = 6;
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
const profilesUpdateClient = getUpdateClient<ProfileUpdate>('profiles');

function formatRegisterError(raw: string, status?: number): string {
  const lower = raw.toLowerCase();
  if (lower.includes('network request failed') || lower.includes('fetch failed') || lower.includes('authretryablefetcherror')) {
    return 'Network connection failed. Please check your internet connection and try again.';
  }
  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Log in failed. Email/username or password is incorrect.';
  }
  if (lower.includes('already registered') || lower.includes('user already') || (lower.includes('email') && (lower.includes('already') || lower.includes('in use') || lower.includes('exists')))) {
    return 'This email is already in use.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Confirm your email or disable "Confirm email" in Supabase.';
  }
  if (lower.includes('23505') || (lower.includes('unique') && lower.includes('username'))) {
    return 'This username is already taken.';
  }
  return raw;
}

type FieldErrors = {
  email?: string;
  username?: string;
  password?: string;
  passwordConfirm?: string;
};

export default function RegisterScreen() {
  const user = useAuthStore((s) => s.user);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): boolean {
    const next: FieldErrors = {};
    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();

    if (!trimmedEmail) {
      next.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      next.email = 'Please enter a valid email address.';
    }
    if (!trimmedUsername) {
      next.username = 'Username is required.';
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = 'Password must be at least 6 characters.';
    }
    if (password !== passwordConfirm) {
      next.passwordConfirm = 'Passwords do not match.';
    }

    setErrors(next);
    setSubmitError(null);
    return Object.keys(next).length === 0;
  }

  async function handleRegister() {
    if (isSubmitting) return;
    if (!validate()) return;

    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();

    setIsSubmitting(true);
    setSubmitError(null);
    setConfirmMessage(null);
    setErrors({});

    try {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', trimmedUsername)
        .limit(1)
        .maybeSingle();
      const existing = data as { id: string } | null;
      if (existing?.id) {
        setSubmitError('This username is already taken.');
        return;
      }

      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: { data: { username: trimmedUsername } },
      });

      if (signUpError) throw signUpError;
      const authUser = authData?.user;
      if (!authUser?.id) throw new Error('Sign up failed.');

      if (!authData?.session && authUser) {
        setConfirmMessage('Please confirm your email, then you can log in.');
        return;
      }

      const profileUpdate: ProfileUpdate = { email: trimmedEmail, username: trimmedUsername };
      const { error: updateError } = await profilesUpdateClient.update(profileUpdate).eq('id', authUser.id);

      if (updateError) throw updateError;

      router.replace('/onboarding/bio');
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string } | null;
      const status = err?.status;
      const raw =
        typeof err?.message === 'string'
          ? err.message
          : e instanceof Error
            ? e.message
            : 'Registration failed.';
      setSubmitError(formatRegisterError(raw, status));
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
          <Text style={styles.eyebrow}>Create your profile</Text>
          <Text style={styles.title}>Set up a sharper, calmer social space</Text>
          <Text style={styles.subtitle}>A few details, then you are straight into camera and chat.</Text>
        </View>

        <Card style={styles.formCard}>
          <AppTextField
            label="Email"
            value={email}
            onChangeText={(t: string) => {
              setEmail(t);
              setErrors((e) => ({ ...e, email: undefined }));
              setSubmitError(null);
            }}
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSubmitting}
            error={errors.email}
          />
          <AppTextField
            label="Username"
            value={username}
            onChangeText={(t: string) => {
              setUsername(t);
              setErrors((e) => ({ ...e, username: undefined }));
              setSubmitError(null);
            }}
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSubmitting}
            error={errors.username}
          />
          <AppTextField
            label="Password"
            key="register-password"
            value={password}
            onChangeText={(t: string) => {
              setPassword(t);
              setErrors((e) => ({ ...e, password: undefined, passwordConfirm: undefined }));
              setSubmitError(null);
            }}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            secureTextEntry
            editable={!isSubmitting}
            error={errors.password}
          />
          <AppTextField
            label="Confirm password"
            key="register-password-confirm"
            value={passwordConfirm}
            onChangeText={(t: string) => {
              setPasswordConfirm(t);
              setErrors((e) => ({ ...e, passwordConfirm: undefined }));
              setSubmitError(null);
            }}
            placeholder="Repeat your password"
            secureTextEntry
            editable={!isSubmitting}
            error={errors.passwordConfirm}
          />

          {confirmMessage ? <Text style={styles.confirmMessage}>{confirmMessage}</Text> : null}
          {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}

          <AppButton
            label={isSubmitting ? 'Creating account...' : 'Create account'}
            onPress={handleRegister}
            disabled={!email.trim() || !username.trim() || !password || !passwordConfirm || isSubmitting}
            loading={isSubmitting}
            icon="sparkles-outline"
          />
          <AppButton
            label="Already have an account? Log in"
            onPress={() => router.push('/login')}
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
  confirmMessage: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  submitError: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  linkButton: {
    marginTop: spacing.xs,
  },
});
