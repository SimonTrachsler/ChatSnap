import '../global.css';
import { useCallback, useEffect, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { initAuthListener, fetchProfileForUser } from '@/lib/supabase';
import { subscribeToIncomingCallSessions, sweepAndGetLatestIncomingRingingCallSession } from '@/lib/calls';
import { useAuthStore } from '@/store/useAuthStore';
import { useProfileStore } from '@/store/useProfileStore';
import { useInboxBadgeStore } from '@/store/useInboxBadgeStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { InAppToast } from '@/components/InAppToast';
import { useInboxRealtime } from '@/hooks/useInboxRealtime';
import { AppState, StyleSheet, View } from 'react-native';
import { colors } from '@/ui/theme';
import { BackgroundDecor } from '@/ui/components/BackgroundDecor';
import { STACK_TRANSITION_OPTIONS } from '@/ui/navigationTransitions';

const LAYOUT_BG = colors.bg;
type SafeRoute = '/' | '/welcome' | '/onboarding/bio';
const INCOMING_CALL_SWEEP_INTERVAL_MS = 15_000;
const INCOMING_CALL_SWEEP_THROTTLE_MS = 5_000;

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
  const router = useRouter();
  const safeReplace = useSafeReplace();
  const { user, loading } = useAuthStore();
  const refreshUnreadMessages = useInboxBadgeStore((s) => s.refreshUnreadMessages);
  const initialRedirectRef = useRef(false);
  const prevUserRef = useRef<typeof user | undefined>(undefined);
  const lastIncomingCallRef = useRef<string | null>(null);
  const lastIncomingSweepAtRef = useRef(0);

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

  useInboxRealtime(refreshUnreadMessages);

  const pushIncomingCall = useCallback((incomingSessionId: string) => {
    if (!incomingSessionId || lastIncomingCallRef.current === incomingSessionId) return;
    lastIncomingCallRef.current = incomingSessionId;
    try {
      router.push(`/call/${incomingSessionId}`);
    } catch {
      setTimeout(() => {
        try {
          router.push(`/call/${incomingSessionId}`);
        } catch {
          // Ignore navigation retry failure.
        }
      }, 50);
    }
  }, [router]);

  const checkPendingIncomingCall = useCallback(async (force = false) => {
    const userId = user?.id;
    if (!userId) return;
    const now = Date.now();
    if (!force && now - lastIncomingSweepAtRef.current < INCOMING_CALL_SWEEP_THROTTLE_MS) return;
    lastIncomingSweepAtRef.current = now;
    try {
      const pendingSession = await sweepAndGetLatestIncomingRingingCallSession(userId);
      if (pendingSession?.id) {
        pushIncomingCall(pendingSession.id);
      }
    } catch (error) {
      console.warn('[calls] pending incoming check failed', error);
    }
  }, [pushIncomingCall, user?.id]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      lastIncomingCallRef.current = null;
      lastIncomingSweepAtRef.current = 0;
      return;
    }
    void checkPendingIncomingCall();
    return subscribeToIncomingCallSessions(userId, (incomingSession) => {
      pushIncomingCall(incomingSession.id);
    });
  }, [checkPendingIncomingCall, pushIncomingCall, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkPendingIncomingCall(true);
      }
    });
    const interval = setInterval(() => {
      void checkPendingIncomingCall(false);
    }, INCOMING_CALL_SWEEP_INTERVAL_MS);
    return () => {
      appStateSub.remove();
      clearInterval(interval);
    };
  }, [checkPendingIncomingCall, user?.id]);

  return (
    /* @ts-expect-error ErrorBoundary type incompatible with React 19 JSX */
    <ErrorBoundary>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.safeArea}>
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
              <Stack.Screen name="call/[sessionId]" options={{ gestureEnabled: false }} />
              <Stack.Screen name="onboarding/bio" options={{ gestureEnabled: false }} />
              <Stack.Screen name="onboarding/avatar" options={{ gestureEnabled: false }} />
            </Stack>
            <InAppToast />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
