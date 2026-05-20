import React from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import { colors, radii, spacing } from '../lib/theme';

export function Card({ children, style, ...rest }: ViewProps) {
  return (
    <View {...rest} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function CardDescription({ children }: { children: React.ReactNode }) {
  return <Text style={styles.desc}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800],
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  title: { color: colors.ink[50], fontSize: 17, fontWeight: '600', marginBottom: spacing.xs },
  desc:  { color: colors.ink[400], fontSize: 13 },
});
