'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Button } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

interface PendingShipment {
  id: string;
  carrierCode: string;
  serviceLevel: string;
  status: string;
  trackingNumber: string | null;
  weightGrams: number;
  order: {
    id: string;
    seller: { displayName: string };
    shippingAddress: { city: string; region: string; country: string; fullName: string };
  };
}

export default function PickupQueue() {
  const { user, loading } = useAuth();
  const [list, setList] = React.useState<PendingShipment[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [scanInput, setScanInput] = React.useState('');

  const reload = React.useCallback(() => {
    if (!user) return;
    api.shipping.pending().then((rows) => setList(rows as PendingShipment[])).catch(() => setList([]));
  }, [user]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function confirmPickup(s: PendingShipment) {
    setBusyId(s.id);
    try {
      await api.shipping.milestone(s.id, {
        code: 'picked_up',
        label: 'Picked up from seller',
        locationCity: s.order.shippingAddress.city,
        locationCountry: s.order.shippingAddress.country,
      });
      reload();
    } finally { setBusyId(null); }
  }

  function handleScan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = scanInput.trim();
    if (!q) return;
    const match = (list ?? []).find((s) =>
      s.trackingNumber === q || s.id === q || s.id.endsWith(q),
    );
    if (match) confirmPickup(match);
    else alert('No matching shipment in the queue');
    setScanInput('');
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!list) return <div className="container py-16 text-ink-400">Loading queue…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Pickup queue</h1>
        <form onSubmit={handleScan} className="flex gap-2">
          <input
            className="ons-input w-72"
            placeholder="Scan or paste tracking #"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
          />
          <Button type="submit" variant="secondary">Confirm pickup</Button>
        </form>
      </div>

      {list.length === 0 ? (
        <div className="ons-card text-center text-ink-400">Queue is clear.</div>
      ) : (
        <div className="space-y-2">
          {list.map((s) => (
            <div key={s.id} className="ons-card flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[260px]">
                <div className="text-xs text-ink-400">#{s.id.slice(-8)} · order #{s.order.id.slice(-8)}</div>
                <div className="font-medium">
                  {s.order.seller.displayName} → {s.order.shippingAddress.fullName}
                </div>
                <div className="text-sm text-ink-400">
                  {s.order.shippingAddress.city}, {s.order.shippingAddress.region} {s.order.shippingAddress.country}
                </div>
              </div>
              <div className="text-sm">
                <Badge tone="accent" className="uppercase">{s.carrierCode}</Badge>{' '}
                <span className="text-ink-300">{s.serviceLevel}</span>
              </div>
              <div className="text-sm text-ink-400">{(s.weightGrams / 1000).toFixed(2)} kg</div>
              <Link href={`/shipments/${s.id}`} className="ons-btn-ghost">Open</Link>
              {s.status === 'LABEL_PURCHASED' && (
                <Button size="sm" loading={busyId === s.id} onClick={() => confirmPickup(s)}>Confirm pickup</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
