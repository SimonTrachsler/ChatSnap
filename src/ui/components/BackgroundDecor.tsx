import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/ui/theme';

export const BackgroundDecor = memo(function BackgroundDecor() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.orb, styles.orbWarm]} />
      <View style={[styles.orb, styles.orbCool]} />
      <View style={[styles.orb, styles.orbSmall]} />
    </View>
  );
});

const styles = StyleSheet.create({
  orb: {
    position: 'absolute',
    borderRadius: 999,
  },
  orbWarm: {
    width: 260,
    height: 260,
    top: -70,
    right: -40,
    backgroundColor: colors.glowWarm,
  },
  orbCool: {
    width: 320,
    height: 320,
    left: -100,
    bottom: 80,
    backgroundColor: colors.glowCool,
  },
  orbSmall: {
    width: 140,
    height: 140,
    top: '38%',
    right: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
});
