import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/ui/theme';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
};

export const PageHeader = memo(function PageHeader({
  eyebrow,
  title,
  subtitle,
  left,
  right,
}: PageHeaderProps) {
  const hasMeta = Boolean(eyebrow || subtitle);

  return (
    <View style={styles.container}>
      <View style={[styles.topRow, hasMeta ? styles.topRowExpanded : styles.topRowCompact]}>
        <View style={[styles.side, styles.sideLeft]}>{left}</View>
        <View style={styles.copy}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  topRow: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  topRowExpanded: { minHeight: 64 },
  topRowCompact: { minHeight: 48 },
  side: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 72,
    justifyContent: 'center',
    zIndex: 2,
  },
  sideLeft: {
    left: 0,
    alignItems: 'flex-start',
  },
  sideRight: {
    right: 0,
    alignItems: 'flex-end',
  },
  copy: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 76,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.accentSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
    textAlign: 'center',
  },
  title: {
    ...typography.title,
    fontSize: 24,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    textAlign: 'center',
  },
});
