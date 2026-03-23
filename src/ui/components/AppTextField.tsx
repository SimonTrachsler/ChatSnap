import { memo } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, spacing } from '@/ui/theme';

type AppTextFieldProps = TextInputProps & {
  label?: string;
  error?: string | null;
  helper?: string | null;
};

export const AppTextField = memo(function AppTextField({
  label,
  error,
  helper,
  style,
  multiline,
  ...props
}: AppTextFieldProps) {
  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor={props.placeholderTextColor ?? colors.textMuted}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          error ? styles.inputError : null,
          style,
        ]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  inputMultiline: {
    minHeight: 132,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: colors.error,
  },
  helper: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textMuted,
  },
  error: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.error,
  },
});
