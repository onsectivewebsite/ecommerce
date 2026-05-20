'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import { api } from '@/lib/api';

export default function AccountRecoveryPage() {
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api.auth.recoveryStart(String(fd.get('email')));
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container py-16 max-w-lg">
      <Card>
        {sent ? (
          <>
            <CardTitle>Check your inbox</CardTitle>
            <CardDescription>
              If an account with two-factor exists for that email, we've sent recovery instructions. Open the email and click "Continue recovery" to start a 72-hour security waiting period.
            </CardDescription>
            <p className="text-sm text-ink-400 mt-6">
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <CardTitle>Recover your account</CardTitle>
            <CardDescription>
              Lost access to your authenticator app, recovery codes, and all your passkeys? You can remove two-factor from your account through account recovery.
            </CardDescription>
            <div className="text-sm text-ink-400 mt-4 space-y-2">
              <p>Here's how it works, and why it takes time:</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>We email you a link to confirm you started this.</li>
                <li>A <strong>72-hour waiting period</strong> begins. We email you reminders so that if someone else started this, you'll notice.</li>
                <li>You can cancel at any point during the wait with one click.</li>
                <li>After 72 hours, you can remove two-factor and sign in with your password.</li>
              </ol>
              <p>
                The wait is a security measure — it makes sure nobody can quietly take over your account just by knowing your email.
              </p>
            </div>
            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
              <Input label="Account email" name="email" type="email" required autoComplete="email" autoFocus />
              {err && <p className="text-danger text-sm">{err}</p>}
              <Button loading={busy} type="submit" fullWidth>
                Start account recovery
              </Button>
            </form>
            <p className="text-sm text-ink-400 mt-6">
              Just need to reset your password? <Link href="/forgot-password">Reset password</Link>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
