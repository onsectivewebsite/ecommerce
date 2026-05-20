'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Money } from '@onsective/ui';
import type { OrderDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function OrdersPage() {
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = React.useState<OrderDto[] | null>(null);

  React.useEffect(() => {
    if (authLoading || !user) return;
    api.orders.list().then(setOrders);
  }, [authLoading, user]);

  if (authLoading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16 text-center">
        <Link href="/login?next=/orders" className="ons-btn-primary">Sign in</Link>
      </div>
    );
  }
  if (!orders) return <div className="container py-16 text-ink-400">Loading orders…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">Your orders</h1>
      {orders.length === 0 ? (
        <p className="text-ink-400">No orders yet. <Link href="/">Start shopping →</Link></p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="ons-card flex items-center gap-4 hover:border-accent-500/40 transition-colors">
              <div className="flex-1">
                <div className="text-xs text-ink-400">Order #{o.id.slice(-8)}</div>
                <div className="font-medium">{o.items.length} item{o.items.length === 1 ? '' : 's'} from {o.sellerName}</div>
                <div className="text-xs text-ink-400">{new Date(o.createdAt).toLocaleString()}</div>
              </div>
              <Badge tone={o.status === 'PAID' ? 'success' : o.status === 'CANCELLED' ? 'danger' : 'accent'}>
                {o.status}
              </Badge>
              <Money amountMinor={o.totalMinor} currency={o.currency} emphasized />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
