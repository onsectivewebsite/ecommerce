'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AllShipmentsPage() {
  const { user, loading } = useAuth();
  const [list, setList] = React.useState<any[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.shipping.pending().then((rows) => setList(rows)).catch(() => setList([]));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!list) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">Shipments in flight</h1>
      <div className="ons-card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-ink-400">
            <tr>
              <th className="text-left p-3">Shipment</th>
              <th className="text-left p-3">Carrier</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Destination</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className="border-t border-ink-800">
                <td className="p-3 font-mono text-xs">#{s.id.slice(-8)}</td>
                <td className="p-3"><Badge tone="accent" className="uppercase">{s.carrierCode}</Badge> {s.serviceLevel}</td>
                <td className="p-3">{s.status}</td>
                <td className="p-3 text-ink-300">{s.order.shippingAddress.city}, {s.order.shippingAddress.country}</td>
                <td className="p-3 text-right"><Link href={`/shipments/${s.id}`} className="text-accent-300">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
