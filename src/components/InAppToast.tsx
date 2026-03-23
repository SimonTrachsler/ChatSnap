import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '@/store/useToastStore';
import { colors, radius, shadows } from '@/ui/theme';

const HIDDEN_OFFSET = -150;

export function InAppToast() {
  const message = useToastStore((s) => s.message);
  const clear = useToastStore((s) => s.clear);
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(HIDDEN_OFFSET)).current;

  useEffect(() => {
    if (message) {
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
    } else {
      Animated.timing(translateY, { toValue: HIDDEN_OFFSET, duration: 200, useNativeDriver: true }).start();
    }
  }, [message, translateY]);

  if (!message) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { top: insets.top + 8 },
        { transform: [{ translateY }] },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity style={styles.toast} onPress={clear} activeOpacity={0.8}>
        <Text style={styles.text} numberOfLines={2}>{message}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 9999,
  },
  toast: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    paddingVertical: 14,
    paddingHorizontal: 18,
    maxWidth: 380,
    width: '100%',
    ...shadows.floating,
  },
  text: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
