'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { Badge, Button, Card, CardTitle, Input } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { PUBLIC_API_URL } from '@/lib/env';

const MILESTONES: { code: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception'; label: string }[] = [
  { code: 'picked_up', label: 'Picked up from seller' },
  { code: 'in_transit', label: 'In transit' },
  { code: 'out_for_delivery', label: 'Out for delivery' },
  { code: 'delivered', label: 'Delivered to recipient' },
  { code: 'exception', label: 'Exception' },
];

export default function ShipmentDetail() {
  const params = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [shipment, setShipment] = React.useState<any | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [city, setCity] = React.useState('');
  const [country, setCountry] = React.useState('');

  const load = React.useCallback(async () => {
    const s = await api.shipping.get(params.id);
    setShipment(s);
  }, [params.id]);

  React.useEffect(() => { if (!loading && user) load(); }, [loading, user, load]);

  React.useEffect(() => {
    if (!user) return;
    const socket: Socket = io(PUBLIC_API_URL, { withCredentials: true });
    socket.emit('track:subscribe', { shipmentId: params.id });
    socket.on('shipment:update', () => { load(); });
    return () => { socket.disconnect(); };
  }, [user, params.id, load]);

  async function push(code: typeof MILESTONES[number]['code'], label: string) {
    setBusy(true);
    try {
      await api.shipping.milestone(params.id, {
        code, label,
        locationCity: city || undefined,
        locationCountry: country || undefined,
      });
      await load();
    } finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!shipment) return <div className="container py-16 text-ink-400">Loading shipment…</div>;

  return (
    <div className="container py-10 max-w-4xl grid md:grid-cols-[1fr_320px] gap-6">
      <Card>
        <CardTitle>Shipment #{shipment.id.slice(-8)}</CardTitle>
        <div className="text-sm text-ink-400 mt-1">
          Order #{shipment.order?.id.slice(-8)} · <Badge tone="accent" className="uppercase">{shipment.carrierCode}</Badge> {shipment.serviceLevel} · <Badge>{shipment.status}</Badge>
        </div>
        {shipment.order && (
          <div className="text-sm text-ink-300 mt-3">
            To: {shipment.order.shippingAddress.fullName}, {shipment.order.shippingAddress.city}, {shipment.order.shippingAddress.country}
          </div>
        )}

        <h3 className="text-sm uppercase tracking-wider text-ink-400 mt-6">Timeline</h3>
        <ol className="mt-2 border-l border-ink-700 ml-2 pl-4 space-y-3">
          {(shipment.events ?? []).map((e: any) => (
            <li key={e.id ?? e.occurredAt} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="text-ink-500 -ml-6">●</span>
                <span className="font-medium">{e.label}</span>
                <span className="text-ink-400">· {new Date(e.occurredAt).toLocaleString()}</span>
              </div>
              {(e.locationCity || e.locationCountry) && (
                <div className="text-ink-400 text-xs">{e.locationCity}{e.locationCity && e.locationCountry ? ', ' : ''}{e.locationCountry}</div>
              )}
            </li>
          ))}
        </ol>
      </Card>

      <aside className="space-y-4">
        <Card>
          <CardTitle>Push milestone</CardTitle>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
            <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {MILESTONES.map((m) => (
              <Button key={m.code} variant="secondary" loading={busy} onClick={() => push(m.code, m.label)}>
                {m.label}
              </Button>
            ))}
          </div>
        </Card>
      </aside>
    </div>
  );
}
