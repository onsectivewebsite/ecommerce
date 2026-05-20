'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { signIn, verifyTwoFactor } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(
    sp.get('denied') === '1' ? 'Admin role required.' : null,
  );
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [useRecovery, setUseRecovery] = React.useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await signIn(String(fd.get('email')), String(fd.get('password')));
      if ('mfaRequired' in res) {
        setChallenge(res.challenge);
      } else {
        router.push('/');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
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
    } finally {
      setBusy(false);
    }
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
            <Button loading={busy} type="submit" fullWidth>
              Verify and sign in
            </Button>
          </form>
          <button
            type="button"
            onClick={() => {
              setErr(null);
              setUseRecovery((v) => !v);
            }}
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
        <CardTitle>Onsective Admin</CardTitle>
        <CardDescription>Restricted to platform staff.</CardDescription>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <Input label="Email" name="email" type="email" required defaultValue="admin@onsective.com" />
          <Input label="Password" name="password" type="password" required defaultValue="OnsectiveAdmin1!" />
          {err && <p className="text-danger text-sm">{err}</p>}
          <Button loading={busy} type="submit" fullWidth>Sign in</Button>
        </form>
      </Card>
    </div>
  );
}
