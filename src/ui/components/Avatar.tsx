import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { colors, shadows } from '@/ui/theme';

const SIZES = { sm: 32, md: 42, ml: 52, lg: 80 } as const;
const FONT_SIZES = { sm: 14, md: 18, ml: 22, lg: 32 } as const;

type AvatarProps = {
  uri?: string | null;
  fallback: string;
  size?: 'sm' | 'md' | 'ml' | 'lg';
};

export const Avatar = memo(function Avatar({ uri, fallback, size = 'md' }: AvatarProps) {
  const dim = SIZES[size];
  const fontSize = FONT_SIZES[size];
  const borderRadius = dim / 2;
  const initial = (fallback || '?').slice(0, 1).toUpperCase();

  if (uri) {
    return (
      <ExpoImage
        source={{ uri }}
        style={[styles.image, { width: dim, height: dim, borderRadius }]}
        contentFit="cover"
        transition={180}
      />
    );
  }

  return (
    <View style={[styles.placeholder, { width: dim, height: dim, borderRadius }]}>
      <View style={styles.placeholderGlow} />
      <Text style={[styles.initial, { fontSize }]}>{initial}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    ...shadows.card,
  },
  placeholder: {
    backgroundColor: colors.bgCardAlt,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    ...shadows.card,
  },
  placeholderGlow: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  initial: {
    fontWeight: '800',
    color: colors.accentSecondary,
    letterSpacing: -0.3,
  },
});
