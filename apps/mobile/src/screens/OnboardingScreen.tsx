import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { colors, spacing } from '../lib/theme';
import type { RootStackParamList } from '../navigation/types';
import { useI18n } from '../lib/i18n-context';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function OnboardingScreen() {
  const nav = useNavigation<Nav>();
  const { t } = useI18n();

  return (
    <Screen scroll={false}>
      <View style={styles.hero}>
        <Text style={styles.brand}>Onsective</Text>
        <Text style={styles.tagline}>{t('home.heroTagline')}</Text>
      </View>
      <View style={{ height: spacing.xl }} />
      <Button title={t('nav.signIn')} block onPress={() => nav.navigate('Auth', { screen: 'Login' })} />
      <View style={{ height: spacing.sm }} />
      <Button title="Create account" variant="secondary" block onPress={() => nav.navigate('Auth', { screen: 'Register' })} />
      <View style={{ height: spacing.sm }} />
      <Button title="Continue as guest" variant="ghost" block onPress={() => nav.navigate('Main', { screen: 'HomeTab', params: { screen: 'Home' } })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: spacing['2xl'], paddingBottom: spacing.lg },
  brand: { color: colors.ink[50], fontSize: 38, fontWeight: '800', letterSpacing: -1 },
  tagline: { color: colors.ink[300], marginTop: spacing.sm, fontSize: 16, lineHeight: 22 },
});
