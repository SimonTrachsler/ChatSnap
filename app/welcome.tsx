import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/useAuthStore';
import { BackgroundDecor } from '@/ui/components/BackgroundDecor';
import { AppButton } from '@/ui/components/AppButton';
import { Card } from '@/ui/components/Card';
import { colors, radius, spacing, typography } from '@/ui/theme';

const AnimatedView = Animated.View;

export default function WelcomeScreen() {
  const router = useRouter();
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const setSessionExpired = useAuthStore((s) => s.setSessionExpired);
  const sessionExpiredShownRef = useRef(false);
  const heroOpacity = useSharedValue(0);
  const heroTranslate = useSharedValue(18);
  const panelOpacity = useSharedValue(0);
  const panelTranslate = useSharedValue(22);

  useEffect(() => {
    heroOpacity.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    heroTranslate.value = withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) });
    panelOpacity.value = withDelay(120, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
    panelTranslate.value = withDelay(120, withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [heroOpacity, heroTranslate, panelOpacity, panelTranslate]);

  useEffect(() => {
    if (sessionExpired && !sessionExpiredShownRef.current) {
      sessionExpiredShownRef.current = true;
      setSessionExpired(false);
      Alert.alert('', 'Session expired. Please log in again.', [{ text: 'OK' }]);
    }
  }, [sessionExpired, setSessionExpired]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroTranslate.value }],
  }));

  const panelStyle = useAnimatedStyle(() => ({
    opacity: panelOpacity.value,
    transform: [{ translateY: panelTranslate.value }],
  }));

  return (
    <View style={styles.container}>
      <BackgroundDecor />
      <AnimatedView style={[styles.hero, heroStyle]}>
        <View style={styles.eyebrowBadge}>
          <Text style={styles.eyebrowText}>Private camera messenger</Text>
        </View>
        <Text style={styles.title}>ChatSnap</Text>
        <Text style={styles.subtitle}>
          Fast snaps, calm chat, clear focus. A social space with a softer midnight mood.
        </Text>
        <View style={styles.featureRow}>
          <View style={styles.featurePill}>
            <Text style={styles.featureText}>Instant capture</Text>
          </View>
          <View style={styles.featurePill}>
            <Text style={styles.featureText}>Private sharing</Text>
          </View>
        </View>
      </AnimatedView>

      <AnimatedView style={[styles.panelWrap, panelStyle]}>
        <Card style={styles.panel}>
          <Text style={styles.panelTitle}>Start your session</Text>
          <Text style={styles.panelCopy}>Jump back into your friends, camera and saved moments.</Text>
          <AppButton label="Log in" onPress={() => router.push('/login')} icon="log-in-outline" />
          <AppButton
            label="Create account"
            onPress={() => router.push('/register')}
            variant="secondary"
            icon="person-add-outline"
            style={styles.secondaryAction}
          />
        </Card>
      </AnimatedView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    justifyContent: 'space-between',
    paddingTop: 88,
    paddingBottom: 44,
  },
  hero: {
    paddingTop: spacing.xl,
  },
  eyebrowBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    marginBottom: spacing.lg,
  },
  eyebrowText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    color: colors.accentSecondary,
  },
  title: {
    ...typography.hero,
    fontSize: 42,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    maxWidth: 320,
    fontSize: 16,
  },
  featureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  featurePill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  featureText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  panelWrap: {
    width: '100%',
  },
  panel: {
    padding: spacing.xl,
  },
  panelTitle: {
    ...typography.subtitle,
    marginBottom: spacing.xs,
  },
  panelCopy: {
    ...typography.body,
    marginBottom: spacing.lg,
  },
  secondaryAction: {
    marginTop: spacing.sm,
  },
});
