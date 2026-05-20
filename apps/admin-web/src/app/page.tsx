'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardDescription, CardTitle, Money } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function Overview() {
  const { user, loading } = useAuth();
  const [pendingSellers, setPendingSellers] = React.useState<number | null>(null);
  const [orderCount, setOrderCount] = React.useState<number | null>(null);
  const [grossMinor, setGrossMinor] = React.useState<number>(0);
  const [commissionMinor, setCommissionMinor] = React.useState<number>(0);

  React.useEffect(() => {
    if (loading || !user) return;
    api.admin.listSellers('PENDING').then((s) => setPendingSellers(s.length));
    api.admin.listOrders().then((orders) => {
      setOrderCount(orders.length);
      setGrossMinor(orders.reduce((s: number, o: any) => s + (o.totalMinor ?? 0), 0));
      setCommissionMinor(orders.reduce((s: number, o: any) => s + (o.commissionMinor ?? 0), 0));
    });
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 space-y-6">
      <h1 className="font-display text-3xl tracking-tight">Platform overview</h1>
      <div className="grid md:grid-cols-4 gap-4">
        <Card>
          <CardTitle>Pending sellers</CardTitle>
          <p className="mt-3 text-3xl font-semibold">{pendingSellers ?? '—'}</p>
          <Link href="/sellers" className="text-sm text-accent-300 mt-2 inline-block">Review queue →</Link>
        </Card>
        <Card>
          <CardTitle>Recent orders</CardTitle>
          <p className="mt-3 text-3xl font-semibold">{orderCount ?? '—'}</p>
        </Card>
        <Card>
          <CardTitle>GMV (recent)</CardTitle>
          <p className="mt-3 text-2xl font-semibold"><Money amountMinor={grossMinor} currency="USD" /></p>
        </Card>
        <Card>
          <CardTitle>Commission (recent)</CardTitle>
          <p className="mt-3 text-2xl font-semibold"><Money amountMinor={commissionMinor} currency="USD" /></p>
          <CardDescription>From the last 200 orders.</CardDescription>
        </Card>
      </div>
    </div>
  );
}
