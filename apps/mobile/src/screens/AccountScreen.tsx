import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card, CardDescription, CardTitle } from '../components/Card';
import { useAuth } from '../lib/auth-context';
import { useI18n, SUPPORTED_LOCALES } from '../lib/i18n-context';
import type { SupportedLocale } from '@onsective/i18n';
import { colors, spacing } from '../lib/theme';

export function AccountScreen() {
  const { user, signOut } = useAuth();
  const { locale, currency, setLocale, setCurrency } = useI18n();

  if (!user) {
    return (
      <Screen>
        <Card>
          <CardTitle>You're browsing as a guest</CardTitle>
          <CardDescription>Sign in to sync your cart, orders and downloads.</CardDescription>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <CardTitle>{user.firstName} {user.lastName}</CardTitle>
        <CardDescription>{user.email} · {user.role}</CardDescription>
      </Card>

      <Card>
        <CardTitle>Language</CardTitle>
        <View style={styles.row}>
          {SUPPORTED_LOCALES.map((l) => (
            <View
              key={l}
              onTouchEnd={() => setLocale(l as SupportedLocale)}
              style={[styles.chip, locale === l && styles.chipActive]}
            >
              <Text style={{ color: colors.ink[50] }}>{l.toUpperCase()}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <CardTitle>Display currency</CardTitle>
        <View style={styles.row}>
          {['USD','EUR','GBP','INR','CAD','JPY','CNY'].map((c) => (
            <View
              key={c}
              onTouchEnd={() => setCurrency(c)}
              style={[styles.chip, currency === c && styles.chipActive]}
            >
              <Text style={{ color: colors.ink[50] }}>{c}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Button
        title="Sign out"
        variant="danger"
        block
        onPress={() => {
          Alert.alert('Sign out?', undefined, [
            { text: 'Cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
          ]);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.ink[800],
    borderRadius: 6,
  },
  chipActive: { backgroundColor: colors.accent[500] },
});
