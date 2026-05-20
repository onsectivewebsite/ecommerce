import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { useAuth } from '../lib/auth-context';
import { colors, radii, spacing } from '../lib/theme';
import type { AuthStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

export function LoginScreen() {
  const nav = useNavigation<Nav>();
  const { signIn } = useAuth();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true); setErr(null);
    try { await signIn(email.trim(), password); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Sign in failed'); }
    finally { setBusy(false); }
  }

  return (
    <Screen>
      <Text style={styles.title}>Welcome back</Text>
      <View style={{ height: spacing.xl }} />
      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        placeholderTextColor={colors.ink[400]}
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />
      <View style={{ height: spacing.sm }} />
      <TextInput
        placeholder="Password"
        secureTextEntry
        placeholderTextColor={colors.ink[400]}
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />
      {err && <Text style={styles.err}>{err}</Text>}
      <View style={{ height: spacing.lg }} />
      <Button title="Sign in" block loading={busy} onPress={submit} />
      <View style={{ height: spacing.sm }} />
      <Button title="Create account" variant="ghost" block onPress={() => nav.navigate('Register')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.ink[50], fontSize: 28, fontWeight: '700' },
  input: {
    color: colors.ink[50],
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800],
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  err: { color: colors.danger, marginTop: spacing.sm, fontSize: 13 },
});
