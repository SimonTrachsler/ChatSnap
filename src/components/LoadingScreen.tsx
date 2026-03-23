/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../types/modules.d.ts" />
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { BackgroundDecor } from '@/ui/components/BackgroundDecor';
import { Card } from '@/ui/components/Card';
import { colors, spacing } from '@/ui/theme';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <View style={styles.container}>
      <BackgroundDecor />
      <Card style={styles.panel}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.message}>{message}</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  panel: {
    minWidth: 200,
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  message: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
  },
});
