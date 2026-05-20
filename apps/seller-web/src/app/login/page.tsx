'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { signIn, signUp, verifyTwoFactor } = useAuth();
  const router = useRouter();
  const [mode, setMode] = React.useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [useRecovery, setUseRecovery] = React.useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      if (mode === 'signin') {
        const res = await signIn(String(fd.get('email')), String(fd.get('password')));
        if ('mfaRequired' in res) {
          setChallenge(res.challenge);
          return;
        }
      } else {
        await signUp(
          String(fd.get('email')),
          String(fd.get('password')),
          String(fd.get('firstName')),
          String(fd.get('lastName')),
        );
      }
      router.push('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  async function submitOtp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      await verifyTwoFactor(challenge, String(fd.get('code')));
      router.push('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  if (challenge) {
    return (
      <div className="container py-16 max-w-md">
        <Card>
          <CardTitle>Two-step verification</CardTitle>
          <CardDescription>
            {useRecovery
              ? 'Enter one of your backup recovery codes.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </CardDescription>
          <form onSubmit={submitOtp} className="mt-6 flex flex-col gap-4">
            <Input
              key={useRecovery ? 'recovery' : 'totp'}
              label={useRecovery ? 'Recovery code' : 'Authenticator code'}
              name="code"
              required
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              placeholder={useRecovery ? 'XXXX-XXXX' : '123456'}
              autoFocus
            />
            {err && <p className="text-danger text-sm">{err}</p>}
            <Button loading={busy} type="submit" fullWidth>Verify and sign in</Button>
          </form>
          <button
            type="button"
            onClick={() => { setErr(null); setUseRecovery((v) => !v); }}
            className="text-sm text-ink-400 hover:text-ink-200 mt-6 underline"
          >
            {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-16 max-w-md">
      <Card>
        <CardTitle>{mode === 'signin' ? 'Seller sign in' : 'Become a seller'}</CardTitle>
        <CardDescription>
          {mode === 'signin' ? 'Manage your store on Onsective.' : 'Create a seller account. Admin approval required before going live.'}
        </CardDescription>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          {mode === 'signup' && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="First name" name="firstName" required />
              <Input label="Last name" name="lastName" required />
            </div>
          )}
          <Input label="Email" name="email" type="email" required defaultValue={mode === 'signin' ? 'seller@onsective.com' : ''} />
          <Input label="Password" name="password" type="password" required minLength={8} defaultValue={mode === 'signin' ? 'OnsectiveSell1!' : ''} />
          {err && <p className="text-danger text-sm">{err}</p>}
          <Button loading={busy} type="submit" fullWidth>{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
        </form>
        <button onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))} className="text-sm text-accent-300 mt-4">
          {mode === 'signin' ? 'New seller? Create an account →' : 'Already a seller? Sign in →'}
        </button>
        <p className="text-xs text-ink-500 mt-3">
          Need the buyer site? <Link href="http://localhost:3000">Open buyer portal →</Link>
        </p>
      </Card>
    </div>
  );
}
