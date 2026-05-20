import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../lib/theme';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
}

export function Screen({ children, scroll = true, padded = true }: Props) {
  const inner = (
    <View style={padded ? styles.padded : undefined}>
      {children}
    </View>
  );
  if (scroll) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return <SafeAreaView style={styles.root} edges={['top']}>{inner}</SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink[950] },
  scroll: { paddingBottom: spacing['2xl'] },
  padded: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
});
