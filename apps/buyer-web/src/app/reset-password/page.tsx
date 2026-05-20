'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import { api } from '@/lib/api';

export default function ResetPasswordPage() {
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ twoFactorRequired: boolean } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get('password'));
    const confirm = String(fd.get('confirm'));
    if (pw !== confirm) {
      setErr('Passwords do not match');
      return;
    }
    if (pw.length < 8) {
      setErr('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      const res = await api.auth.passwordReset(token, pw);
      setDone({ twoFactorRequired: res.twoFactorRequired });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reset password');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="container py-16 max-w-md">
        <Card>
          <CardTitle>Invalid link</CardTitle>
          <CardDescription>This reset link is missing its token. Request a new one.</CardDescription>
          <Link href="/forgot-password" className="ons-btn-primary mt-6 inline-block">
            Request a new link
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-16 max-w-md">
      <Card>
        {done ? (
          <>
            <CardTitle>Password updated</CardTitle>
            <CardDescription>
              Your password has been changed and all other sessions were signed out.
              {done.twoFactorRequired
                ? ' Since two-factor is on, you\'ll still need your authenticator or passkey to sign in.'
                : ''}
            </CardDescription>
            <Link href="/login" className="ons-btn-primary mt-6 inline-block">
              Sign in
            </Link>
          </>
        ) : (
          <>
            <CardTitle>Choose a new password</CardTitle>
            <CardDescription>Pick something you don't use anywhere else.</CardDescription>
            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
              <Input
                label="New password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                autoFocus
              />
              <Input
                label="Confirm new password"
                name="confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              {err && <p className="text-danger text-sm">{err}</p>}
              <Button loading={busy} type="submit" fullWidth>
                Update password
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
