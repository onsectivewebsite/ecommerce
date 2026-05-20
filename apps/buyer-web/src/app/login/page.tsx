'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api, setAccessToken } from '@/lib/api';
import { describeError, getAssertion, isWebAuthnSupported } from '@/lib/webauthn';

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get('next') ?? '/';
  const { signIn, verifyTwoFactor, refresh } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [useRecovery, setUseRecovery] = React.useState(false);
  const [passkeysSupported, setPasskeysSupported] = React.useState(false);

  React.useEffect(() => {
    setPasskeysSupported(isWebAuthnSupported());
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await signIn(String(fd.get('email')), String(fd.get('password')));
      if ('mfaRequired' in res) {
        setChallenge(res.challenge);
      } else {
        router.push(next);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitOtp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      await verifyTwoFactor(challenge, String(fd.get('code')));
      router.push(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function onPasskeyAsSecondFactor() {
    if (!challenge) return;
    setBusy(true);
    setErr(null);
    try {
      const opts = await api.auth.webauthnLoginOptions();
      const assertion = await getAssertion(opts.publicKey);
      const result = await api.auth.twoFactorVerifyPasskey({
        loginChallenge: challenge,
        challenge: opts.challenge,
        credentialId: assertion.credentialId,
        clientDataJSON: assertion.clientDataJSON,
        authenticatorData: assertion.authenticatorData,
        signature: assertion.signature,
      });
      setAccessToken(result.accessToken);
      await refresh().catch(() => undefined);
      router.push(next);
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPasswordlessPasskey() {
    setBusy(true);
    setErr(null);
    try {
      const opts = await api.auth.webauthnLoginOptions();
      const assertion = await getAssertion(opts.publicKey);
      const result = await api.auth.webauthnLoginVerify({
        challenge: opts.challenge,
        credentialId: assertion.credentialId,
        clientDataJSON: assertion.clientDataJSON,
        authenticatorData: assertion.authenticatorData,
        signature: assertion.signature,
        userHandle: assertion.userHandle,
      });
      setAccessToken(result.accessToken);
      await refresh().catch(() => undefined);
      router.push(next);
    } catch (e) {
      setErr(describeError(e));
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
          <form onSubmit={onSubmitOtp} className="mt-6 flex flex-col gap-4">
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
          <div className="mt-6 flex flex-col gap-3">
            {passkeysSupported && (
              <button
                type="button"
                onClick={onPasskeyAsSecondFactor}
                disabled={busy}
                className="text-sm text-accent-300 hover:text-accent-200 underline text-left"
              >
                Use a passkey instead
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setUseRecovery((v) => !v);
              }}
              className="text-sm text-ink-400 hover:text-ink-200 underline text-left"
            >
              {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-16 max-w-md">
      <Card>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Sign in to continue shopping on Onsective.</CardDescription>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <Input label="Email" name="email" type="email" required autoComplete="email" defaultValue="buyer@onsective.com" />
          <Input label="Password" name="password" type="password" required autoComplete="current-password" defaultValue="OnsectiveBuy1!" />
          {err && <p className="text-danger text-sm">{err}</p>}
          <Button loading={busy} type="submit" fullWidth>Sign in</Button>
        </form>
        {passkeysSupported && (
          <button
            type="button"
            onClick={onPasswordlessPasskey}
            disabled={busy}
            className="mt-4 text-sm text-accent-300 hover:text-accent-200 underline text-left"
          >
            Sign in with a passkey instead →
          </button>
        )}
        <p className="text-sm text-ink-400 mt-6">
          <Link href="/forgot-password">Forgot your password?</Link>
        </p>
        <p className="text-sm text-ink-400 mt-2">
          New here? <Link href="/register">Create an account</Link>
        </p>
      </Card>
    </div>
  );
}
