'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function OnboardingPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      await api.seller.createProfile({
        storeName: String(fd.get('storeName')),
        displayName: String(fd.get('displayName')),
        payoutCurrency: String(fd.get('payoutCurrency') ?? 'USD'),
      });
      await refresh();
      router.push('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-16 max-w-lg">
      <Card>
        <CardTitle>Create your store</CardTitle>
        <CardDescription>An Onsective admin will review and approve before your products go live.</CardDescription>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <Input label="Store handle" name="storeName" hint="Lowercase, dashes only — used in URLs." required />
          <Input label="Display name" name="displayName" required />
          <Input label="Payout currency" name="payoutCurrency" defaultValue="USD" maxLength={3} />
          {err && <p className="text-danger text-sm">{err}</p>}
          <Button loading={busy} type="submit" fullWidth>Submit for approval</Button>
        </form>
      </Card>
    </div>
  );
}
