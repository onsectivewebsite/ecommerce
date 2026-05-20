import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { colors, radii, spacing } from '../lib/theme';

interface Props extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  block?: boolean;
}

export function Button({ title, variant = 'primary', loading, block, disabled, ...rest }: Props) {
  const tone = TONES[variant];
  return (
    <Pressable
      {...rest}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        block && styles.block,
        { backgroundColor: tone.bg, borderColor: tone.border },
        pressed && { opacity: 0.85 },
        (disabled || loading) && { opacity: 0.5 },
      ]}
    >
      {loading
        ? <ActivityIndicator color={tone.fg} />
        : <Text style={[styles.label, { color: tone.fg }]}>{title}</Text>}
    </Pressable>
  );
}

const TONES = {
  primary:   { bg: colors.accent[500], border: colors.accent[700], fg: '#ffffff' },
  secondary: { bg: colors.ink[800],    border: colors.ink[700],    fg: colors.ink[50] },
  ghost:     { bg: 'transparent',      border: 'transparent',      fg: colors.ink[200] },
  danger:    { bg: 'transparent',      border: colors.danger,      fg: colors.danger },
};

const styles = StyleSheet.create({
  base: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { alignSelf: 'stretch' },
  label: { fontSize: 15, fontWeight: '600' },
});
