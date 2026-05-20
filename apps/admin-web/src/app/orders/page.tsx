'use client';

import * as React from 'react';
import { Badge, Money } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminOrders() {
  const { user, loading } = useAuth();
  const [orders, setOrders] = React.useState<any[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.admin.listOrders().then((res) => setOrders(res as any[]));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!orders) return <div className="container py-16 text-ink-400">Loading orders…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">Orders (last 200)</h1>
      <div className="ons-card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-ink-400">
            <tr>
              <th className="text-left p-3">Order</th>
              <th className="text-left p-3">Buyer</th>
              <th className="text-left p-3">Seller</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Total</th>
              <th className="text-right p-3">Commission</th>
              <th className="text-right p-3">When</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-ink-800">
                <td className="p-3 font-mono text-xs">#{o.id.slice(-8)}</td>
                <td className="p-3">{o.buyerEmail}</td>
                <td className="p-3">{o.sellerName}</td>
                <td className="p-3"><Badge tone={o.status === 'PAID' ? 'success' : 'accent'}>{o.status}</Badge></td>
                <td className="p-3 text-right"><Money amountMinor={o.totalMinor} currency={o.currency} /></td>
                <td className="p-3 text-right text-gold-400"><Money amountMinor={o.commissionMinor} currency={o.currency} /></td>
                <td className="p-3 text-right text-ink-400">{new Date(o.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
