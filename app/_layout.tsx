import '../global.css';
import { useCallback, useEffect, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { initAuthListener, fetchProfileForUser } from '@/lib/supabase';
import { trackEvent } from '@/lib/telemetry';
import { useAuthStore } from '@/store/useAuthStore';
import { useProfileStore } from '@/store/useProfileStore';
import { useInboxBadgeStore } from '@/store/useInboxBadgeStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { InAppToast } from '@/components/InAppToast';
import { useInboxRealtime } from '@/hooks/useInboxRealtime';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/ui/theme';
import { BackgroundDecor } from '@/ui/components/BackgroundDecor';
import { STACK_TRANSITION_OPTIONS } from '@/ui/navigationTransitions';

const LAYOUT_BG = colors.bg;
type SafeRoute = '/' | '/welcome' | '/onboarding/bio';

// Navigation mit Retry (Root-Layout darf useRootNavigationState nicht nutzen – wirft dort)
function useSafeReplace() {
  const router = useRouter();
  return useCallback((path: SafeRoute) => {
    try {
      router.replace(path);
    } catch {
      setTimeout(() => router.replace(path), 50);
    }
  }, [router]);
}

export default function RootLayout() {
  return (
    /* @ts-expect-error ErrorBoundary type incompatible with React 19 JSX */
    <ErrorBoundary>
      <SafeAreaProvider>
        <RootLayoutContent />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

function RootLayoutContent() {
  const safeReplace = useSafeReplace();
  const { user, loading } = useAuthStore();
  const insets = useSafeAreaInsets();
  const refreshUnreadMessages = useInboxBadgeStore((s) => s.refreshUnreadMessages);
  const refreshUnreadMessagesNow = useCallback(() => {
    void refreshUnreadMessages({ force: true });
  }, [refreshUnreadMessages]);
  const initialRedirectRef = useRef(false);
  const prevUserRef = useRef<typeof user | undefined>(undefined);

  // Auth gate: on app start getSession() runs in initAuthListener; store gets session or null
  useEffect(() => {
    const cleanup = initAuthListener();
    return cleanup;
  }, []);

  // Load profile when user is set (no forced logout)
  useEffect(() => {
    const uid = user?.id ?? null;
    const { setProfile, setProfileError, setProfileLoading } = useProfileStore.getState();
    if (!uid) {
      setProfile(null);
      setProfileError(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    setProfileError(null);
    fetchProfileForUser(uid)
      .then((row) => {
        useProfileStore.getState().setProfile(row);
        useProfileStore.getState().setProfileLoading(false);
        if (!row) {
          useProfileStore.getState().setProfileError(
            'Profile not found. Please contact support or sign out and sign up again.'
          );
        }
      })
      .catch(() => {
        useProfileStore.getState().setProfileError('Profile could not be loaded.');
        useProfileStore.getState().setProfileLoading(false);
      });
  }, [user?.id]);

  const profile = useProfileStore((s) => s.profile);
  const profileLoading = useProfileStore((s) => s.profileLoading);

  // Auth gate: after getSession() result — session exists → (tabs) or onboarding, no session → Welcome
  useEffect(() => {
    if (loading || profileLoading) return;
    if (initialRedirectRef.current) return;
    initialRedirectRef.current = true;
    const t = setTimeout(() => {
      if (!user) {
        safeReplace('/welcome');
      } else if (profile && !profile.onboarding_completed) {
        safeReplace('/onboarding/bio');
      } else {
        safeReplace('/');
      }
    }, 0);
    return () => clearTimeout(t);
  }, [loading, profileLoading, user, profile, safeReplace]);

  // When session becomes null later (e.g. user tapped Logout) → redirect to Welcome
  useEffect(() => {
    if (loading || profileLoading) return;
    const prev = prevUserRef.current;
    prevUserRef.current = user;
    if (prev === undefined) return;
    if (user && !prev) {
      const dest: SafeRoute = profile && !profile.onboarding_completed ? '/onboarding/bio' : '/';
      const t = setTimeout(() => safeReplace(dest), 0);
      return () => clearTimeout(t);
    }
    if (!user && prev) {
      const t = setTimeout(() => safeReplace('/welcome'), 0);
      return () => clearTimeout(t);
    }
  }, [loading, profileLoading, user, profile, safeReplace]);

  useInboxRealtime(refreshUnreadMessagesNow);

  useEffect(() => {
    if (!user?.id) return;
    void trackEvent('app_session_active');
  }, [user?.id]);

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      <BackgroundDecor />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: LAYOUT_BG },
          ...STACK_TRANSITION_OPTIONS,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="snap/[id]" />
        <Stack.Screen name="story/[id]" />
        <Stack.Screen name="onboarding/bio" options={{ gestureEnabled: false }} />
        <Stack.Screen name="onboarding/avatar" options={{ gestureEnabled: false }} />
      </Stack>
      <InAppToast />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
