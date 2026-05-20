'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';

export default function RegisterPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { signUp } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  // Phase 25: pull ?ref=ABCDEFGH from the share link.
  const referralCode = (params.get('ref') ?? '').trim().toUpperCase() || undefined;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      await signUp(
        String(fd.get('email')),
        String(fd.get('password')),
        String(fd.get('firstName')),
        String(fd.get('lastName')),
        referralCode,
      );
      router.push('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container py-16 max-w-md">
      <Card>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>One account, four portals — buyer, seller, admin, shipping.</CardDescription>
        {referralCode && (
          <div className="mt-4 ons-card border-gold-400/30 bg-gold-500/10 text-sm">
            You’re joining with referral code <span className="font-mono">{referralCode}</span> — you and your friend will both earn bonus points on your first paid order.
          </div>
        )}
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First name" name="firstName" required />
            <Input label="Last name" name="lastName" required />
          </div>
          <Input label="Email" name="email" type="email" required />
          <Input label="Password" name="password" type="password" required minLength={8} hint="At least 8 characters." />
          {err && <p className="text-danger text-sm">{err}</p>}
          <Button loading={busy} type="submit" fullWidth>Create account</Button>
        </form>
        <p className="text-sm text-ink-400 mt-6">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}
