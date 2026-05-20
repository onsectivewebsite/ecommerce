import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { useAuth } from '../lib/auth-context';
import { colors, radii, spacing } from '../lib/theme';

export function RegisterScreen() {
  const { signUp } = useAuth();
  const [first, setFirst] = React.useState('');
  const [last, setLast] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true); setErr(null);
    try { await signUp(email.trim(), password, first.trim(), last.trim()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Sign up failed'); }
    finally { setBusy(false); }
  }

  return (
    <Screen>
      <Text style={styles.title}>Create your Onsective account</Text>
      <View style={{ height: spacing.lg }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TextInput placeholder="First name" placeholderTextColor={colors.ink[400]} style={[styles.input, { flex: 1 }]} value={first} onChangeText={setFirst} />
        <TextInput placeholder="Last name" placeholderTextColor={colors.ink[400]} style={[styles.input, { flex: 1 }]} value={last} onChangeText={setLast} />
      </View>
      <View style={{ height: spacing.sm }} />
      <TextInput placeholder="Email" autoCapitalize="none" keyboardType="email-address" placeholderTextColor={colors.ink[400]} style={styles.input} value={email} onChangeText={setEmail} />
      <View style={{ height: spacing.sm }} />
      <TextInput placeholder="Password (min 12 chars)" secureTextEntry placeholderTextColor={colors.ink[400]} style={styles.input} value={password} onChangeText={setPassword} />
      {err && <Text style={{ color: colors.danger, marginTop: spacing.sm, fontSize: 13 }}>{err}</Text>}
      <View style={{ height: spacing.lg }} />
      <Button title="Join" block loading={busy} onPress={submit} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.ink[50], fontSize: 24, fontWeight: '700' },
  input: {
    color: colors.ink[50],
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800],
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 48,
  },
});
