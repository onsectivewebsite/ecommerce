'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card, CardDescription, CardTitle, Money } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function Dashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = React.useState<any>(null);
  const [revenueMinor, setRevenueMinor] = React.useState<number>(0);
  const [ordersCount, setOrdersCount] = React.useState<number>(0);

  React.useEffect(() => {
    if (loading) return;
    if (!user) { router.push('/login'); return; }
    api.seller.myProfile().then(setProfile).catch(() => router.push('/onboarding'));
    api.seller.listOrders().then((orders) => {
      setOrdersCount(orders.length);
      setRevenueMinor(orders.filter((o) => o.status === 'PAID' || o.status === 'DELIVERED').reduce((s, o) => s + o.totalMinor, 0));
    }).catch(() => undefined);
  }, [loading, user, router]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!profile) return <div className="container py-16 text-ink-400">Setting up…</div>;

  return (
    <div className="container py-10 space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Welcome, {user.firstName}</h1>
        <p className="text-ink-400">
          Store: <span className="text-ink-200 font-medium">{profile.displayName}</span> ·
          <Badge tone={profile.status === 'APPROVED' ? 'success' : profile.status === 'PENDING' ? 'warning' : 'danger'} className="ml-2">
            {profile.status}
          </Badge>
        </p>
      </header>

      {profile.status !== 'APPROVED' && (
        <Card>
          <CardTitle>Approval pending</CardTitle>
          <CardDescription>You can configure your store, but products go live only after admin approval.</CardDescription>
        </Card>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardTitle>Lifetime revenue</CardTitle>
          <p className="mt-2"><Money amountMinor={revenueMinor} currency={profile.payoutCurrency ?? 'USD'} emphasized className="text-3xl" /></p>
        </Card>
        <Card>
          <CardTitle>Orders</CardTitle>
          <p className="mt-2 text-3xl font-semibold">{ordersCount}</p>
        </Card>
        <Card>
          <CardTitle>Quick actions</CardTitle>
          <div className="mt-3 flex flex-col gap-2">
            <Link className="ons-btn-secondary" href="/products/new">+ New product</Link>
            <Link className="ons-btn-secondary" href="/orders">Manage orders</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
