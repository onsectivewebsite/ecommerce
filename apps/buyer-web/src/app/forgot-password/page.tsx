'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api.auth.passwordForgot(String(fd.get('email')));
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container py-16 max-w-md">
      <Card>
        {sent ? (
          <>
            <CardTitle>Check your inbox</CardTitle>
            <CardDescription>
              If an account exists for that email, we've sent a password-reset link. It expires in one hour. Don't forget to check spam.
            </CardDescription>
            <p className="text-sm text-ink-400 mt-6">
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <CardTitle>Reset your password</CardTitle>
            <CardDescription>
              Enter the email on your account and we'll send you a link to set a new password.
            </CardDescription>
            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
              <Input label="Email" name="email" type="email" required autoComplete="email" autoFocus />
              {err && <p className="text-danger text-sm">{err}</p>}
              <Button loading={busy} type="submit" fullWidth>
                Send reset link
              </Button>
            </form>
            <p className="text-sm text-ink-400 mt-6">
              Remembered it? <Link href="/login">Sign in</Link>
            </p>
            <p className="text-sm text-ink-400 mt-2">
              Lost access to your authenticator too?{' '}
              <Link href="/account-recovery">Recover your account</Link>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
