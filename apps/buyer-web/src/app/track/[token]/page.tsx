'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { Badge, Card, CardDescription, CardTitle } from '@onsective/ui';
import type { ShipmentPublicDto } from '@onsective/shared-types';
import { api } from '@/lib/api';
import { PUBLIC_API_URL } from '@/lib/env';

const STEPS: { code: string; label: string }[] = [
  { code: 'label_created', label: 'Label' },
  { code: 'picked_up', label: 'Pickup' },
  { code: 'in_transit', label: 'In transit' },
  { code: 'out_for_delivery', label: 'Out for delivery' },
  { code: 'delivered', label: 'Delivered' },
];

function progressIndex(events: { code: string }[]): number {
  if (!events.length) return 0;
  const codes = new Set(events.map((e) => e.code));
  let idx = 0;
  STEPS.forEach((s, i) => { if (codes.has(s.code)) idx = i; });
  return idx;
}

export default function PublicTrackingPage() {
  const params = useParams<{ token: string }>();
  const [shipment, setShipment] = React.useState<ShipmentPublicDto | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const s = await api.shipping.publicTrack(params.token);
      setShipment(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Tracking not found');
    }
  }, [params.token]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    const socket: Socket = io(PUBLIC_API_URL, { withCredentials: true });
    socket.emit('track:subscribe', { publicToken: params.token });
    socket.on('shipment:update', () => { load(); });
    return () => { socket.disconnect(); };
  }, [params.token, load]);

  if (err) return <div className="container py-16 text-danger">{err}</div>;
  if (!shipment) return <div className="container py-16 text-ink-400">Loading tracking…</div>;

  const stepIndex = progressIndex(shipment.events);

  return (
    <div className="container py-12 max-w-3xl">
      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Tracking #{shipment.trackingNumber ?? shipment.id.slice(-8)}</CardTitle>
            <CardDescription>
              Order #{shipment.orderId.slice(-8)} · {shipment.sellerName} → {shipment.destinationCity}, {shipment.destinationCountry}
            </CardDescription>
          </div>
          <Badge tone={shipment.status === 'DELIVERED' ? 'success' : shipment.status === 'EXCEPTION' ? 'danger' : 'accent'}>
            {shipment.status}
          </Badge>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.code}>
                <div className="flex flex-col items-center">
                  <div className={[
                    'h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold',
                    i <= stepIndex ? 'bg-accent-500 text-white' : 'bg-ink-800 text-ink-400 border border-ink-700',
                  ].join(' ')}>{i + 1}</div>
                  <span className={['text-xs mt-2', i <= stepIndex ? 'text-ink-100' : 'text-ink-500'].join(' ')}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={['h-px flex-1 mx-1', i < stepIndex ? 'bg-accent-500' : 'bg-ink-800'].join(' ')} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <h3 className="text-sm uppercase tracking-wider text-ink-400 mt-10">Timeline</h3>
        <ol className="mt-3 border-l border-ink-700 ml-2 pl-4 space-y-3">
          {shipment.events.length === 0 ? (
            <li className="text-ink-400 text-sm">No updates yet.</li>
          ) : (
            shipment.events.map((e, idx) => (
              <li key={idx} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-accent-400 -ml-6">●</span>
                  <span className="font-medium">{e.label}</span>
                  <span className="text-ink-400">· {new Date(e.occurredAt).toLocaleString()}</span>
                </div>
                {(e.locationCity || e.locationCountry) && (
                  <div className="text-ink-400 text-xs">
                    {e.locationCity}{e.locationCity && e.locationCountry ? ', ' : ''}{e.locationCountry}
                  </div>
                )}
              </li>
            ))
          )}
        </ol>
      </Card>
    </div>
  );
}
