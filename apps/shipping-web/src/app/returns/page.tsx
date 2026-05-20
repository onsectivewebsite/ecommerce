'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { PendingReturnRow, ReturnDisposition } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const DISPOSITIONS: Array<{ value: ReturnDisposition; label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = [
  { value: 'OUTLET_RELIST', label: 'Outlet relist', tone: 'success' },
  { value: 'REFURB_REGRADE', label: 'Refurb regrade', tone: 'warning' },
  { value: 'DISPOSE', label: 'Dispose', tone: 'danger' },
  { value: 'RETURN_TO_SELLER', label: 'Return to seller', tone: 'neutral' },
];

export default function ShippingReturnsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<PendingReturnRow[] | null>(null);
  const [warehouseId, setWarehouseId] = React.useState('');
  const [openFor, setOpenFor] = React.useState<string | null>(null);
  const [disposition, setDisposition] = React.useState<ReturnDisposition>('OUTLET_RELIST');
  const [discount, setDiscount] = React.useState<number>(1500);
  const [notes, setNotes] = React.useState('');
  const [disposeReason, setDisposeReason] = React.useState('');
  const [photos, setPhotos] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.returnsDisposition.warehouseQueue().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
    // Pre-fill warehouse from the first active one.
    api.warehouses.publicList().then((list) => {
      if (list.length > 0) setWarehouseId(list[0].id);
    }).catch(() => undefined);
  }, [loading, user, load]);

  async function submit(r: PendingReturnRow) {
    setBusy(r.id); setErr(null);
    try {
      await api.returnsDisposition.inspect({
        returnId: r.id,
        warehouseId,
        disposition,
        conditionNotes: notes || undefined,
        photoUrls: photos.split(',').map((s) => s.trim()).filter(Boolean),
        outletDiscountBps: disposition === 'OUTLET_RELIST' ? discount : undefined,
        disposeReason: disposition === 'DISPOSE' ? disposeReason : undefined,
      });
      setOpenFor(null); setNotes(''); setPhotos(''); setDisposeReason('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading returns queue…</div>;

  return (
    <div className="container py-10">
      <header className="mb-6">
        <h1 className="font-display text-3xl tracking-tight">Returns intake</h1>
        <p className="text-sm text-ink-400 mt-1">
          Inspect each return and pick a disposition. Outlet relist creates an OPEN_BOX
          unit on the same product (quarantined until the auth check passes).
        </p>
      </header>

      <input value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
             placeholder="Warehouse ID (defaulted from list)" className="ons-input mb-4 max-w-md" />

      {err && <div className="text-danger text-sm mb-4">{err}</div>}

      {rows.length === 0 ? <p className="text-ink-400">No pending returns.</p> : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="ons-card">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge tone="warning">{r.status}</Badge>
                <div className="flex-1 min-w-[220px]">
                  <p className="font-medium text-sm">
                    {r.items.map((i) => i.orderItem.productTitleSnapshot).join(', ') || `Return ${r.id.slice(-8)}`}
                  </p>
                  <p className="text-xs text-ink-400 mt-1">
                    Order {r.orderId.slice(-8)} · {r.items.length} item(s)
                  </p>
                </div>
                <button onClick={() => setOpenFor(openFor === r.id ? null : r.id)} className="ons-btn-ghost text-sm">
                  {openFor === r.id ? 'Close' : 'Inspect'}
                </button>
              </div>

              {openFor === r.id && (
                <div className="mt-4 border-t border-ink-800 pt-4 space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    {DISPOSITIONS.map((d) => (
                      <button key={d.value} type="button" onClick={() => setDisposition(d.value)}
                              className={[
                                'rounded-lg border px-3 py-2 text-xs',
                                disposition === d.value ? 'border-gold-500 bg-gold-500/10 text-gold-200' : 'border-ink-800 text-ink-300',
                              ].join(' ')}>{d.label}</button>
                    ))}
                  </div>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                            placeholder="Inspector notes" className="ons-input min-h-[80px]" />
                  <input value={photos} onChange={(e) => setPhotos(e.target.value)}
                         placeholder="Photo URLs (comma-separated)" className="ons-input" />
                  {disposition === 'OUTLET_RELIST' && (
                    <input type="number" min={0} max={5000} step={100} value={discount}
                           onChange={(e) => setDiscount(Number(e.target.value))}
                           placeholder="Outlet discount bps (e.g. 1500 = 15%)" className="ons-input max-w-sm" />
                  )}
                  {disposition === 'DISPOSE' && (
                    <input value={disposeReason} onChange={(e) => setDisposeReason(e.target.value)}
                           placeholder="Dispose reason (required)" className="ons-input" />
                  )}
                  <button disabled={busy === r.id || !warehouseId || (disposition === 'DISPOSE' && !disposeReason)}
                          onClick={() => submit(r)} className="ons-btn-primary text-sm">
                    Submit disposition
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
