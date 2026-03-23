import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';

const AnimatedView = Animated.View;

/**
 * Full-screen screen shown while the app checks for an existing session (cold start).
 * Shows "Welcome to ChatSnap" with a subtle animation and spinner.
 */
export function SessionCheckScreen() {
  const titleOpacity = useSharedValue(0);
  const spinnerOpacity = useSharedValue(0.4);

  useEffect(() => {
    titleOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
    spinnerOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 800, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, [spinnerOpacity, titleOpacity]);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
  }));

  const spinnerStyle = useAnimatedStyle(() => ({
    opacity: spinnerOpacity.value,
  }));

  return (
    <View style={styles.container}>
      <AnimatedView style={titleStyle}>
        <Text style={styles.title}>Welcome to ChatSnap</Text>
        <Text style={styles.subtitle}>Checking session…</Text>
      </AnimatedView>
      <AnimatedView style={[styles.spinnerWrap, spinnerStyle]}>
        <ActivityIndicator size="large" color="#64748b" />
      </AnimatedView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#f8fafc',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 10,
    textAlign: 'center',
  },
  spinnerWrap: {
    marginTop: 40,
  },
});
