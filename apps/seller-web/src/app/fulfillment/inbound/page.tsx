'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { InboundShipmentRow, PublicWarehouseRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function tone(s: InboundShipmentRow['status']): 'success' | 'warning' | 'danger' | 'neutral' | 'accent' {
  if (s === 'RECEIVED' || s === 'CLOSED') return 'success';
  if (s === 'IN_TRANSIT') return 'accent';
  if (s === 'CANCELLED') return 'danger';
  return 'neutral';
}

export default function SellerInboundPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<InboundShipmentRow[] | null>(null);
  const [warehouses, setWarehouses] = React.useState<PublicWarehouseRow[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.inbound.list().then(setRows).catch(() => setRows([]));
    api.warehouses.publicList().then(setWarehouses).catch(() => setWarehouses([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function ship(id: string) {
    const carrierCode = prompt('Carrier code (e.g. fedex):');
    if (!carrierCode) return;
    const trackingNumber = prompt('Tracking number:');
    if (!trackingNumber) return;
    setBusyId(id);
    try { await api.inbound.ship(id, { carrierCode, trackingNumber }); load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function cancel(id: string) {
    if (!confirm('Cancel this inbound shipment?')) return;
    setBusyId(id);
    try { await api.inbound.cancel(id); load(); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading inbound shipments…</div>;

  return (
    <div className="container py-10 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Inbound shipments</h1>
        <a href="/fulfillment/inbound/new" className="ons-btn-primary text-sm">+ New shipment</a>
      </div>
      <p className="text-sm text-ink-400 mb-6">
        Send inventory to Onsective Fulfillment warehouses so we can pick, pack, and ship orders on your behalf.
        {warehouses.length > 0 && ` ${warehouses.length} warehouse${warehouses.length === 1 ? '' : 's'} accepting inbound.`}
      </p>
      {err && <div className="ons-card text-danger mb-4">{err}</div>}

      {rows.length === 0 ? (
        <p className="text-ink-400">No inbound shipments yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="ons-card flex items-center gap-4">
              <div className="flex-1">
                <div className="text-xs text-ink-400">#{r.id.slice(-8)} · to {r.warehouse?.code ?? r.warehouseId}</div>
                <div className="font-medium">{r.items.length} line{r.items.length === 1 ? '' : 's'} · {r.items.reduce((s, i) => s + i.expectedQty, 0)} units</div>
                <div className="text-xs text-ink-400">Created {new Date(r.createdAt).toLocaleString()}</div>
                {r.trackingNumber && <div className="text-xs text-ink-300">{r.carrierCode} · {r.trackingNumber}</div>}
              </div>
              <Badge tone={tone(r.status)}>{r.status.replace(/_/g, ' ')}</Badge>
              <div className="flex flex-col gap-1">
                {r.status === 'DRAFT' && (
                  <>
                    <button disabled={busyId === r.id} onClick={() => ship(r.id)} className="ons-btn-primary text-sm">Mark shipped</button>
                    <button disabled={busyId === r.id} onClick={() => cancel(r.id)} className="ons-btn-ghost text-sm text-danger">Cancel</button>
                  </>
                )}
                {r.status === 'IN_TRANSIT' && (
                  <button disabled={busyId === r.id} onClick={() => cancel(r.id)} className="ons-btn-ghost text-sm text-danger">Cancel</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
