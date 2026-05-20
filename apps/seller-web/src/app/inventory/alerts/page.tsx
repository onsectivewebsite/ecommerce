'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { ForecastAlertRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function InventoryAlertsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<ForecastAlertRow[] | null>(null);
  const [includeAcked, setIncludeAcked] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.forecast.list(includeAcked).then(setRows).catch(() => setRows([]));
  }, [includeAcked]);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function ack(id: string) {
    setBusyId(id);
    try { await api.forecast.acknowledge(id); load(); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading alerts…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Low-stock alerts</h1>
        <label className="flex items-center gap-2 text-sm text-ink-300">
          <input type="checkbox" checked={includeAcked} onChange={(e) => setIncludeAcked(e.target.checked)} />
          Include acknowledged
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-400">Nothing to flag. All inventory is healthy at current sales rates.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <div key={a.id} className="ons-card flex items-center gap-4">
              <Badge tone={a.severity === 'CRITICAL' ? 'danger' : 'warning'}>{a.severity}</Badge>
              <div className="flex-1">
                <div className="font-medium">{a.variant.product.title} — {a.variant.name}</div>
                <div className="text-xs text-ink-400">
                  SKU {a.variant.sku} · stock {a.variant.inventoryQty} · selling {a.velocityPerDay.toFixed(2)}/day → ~{a.daysUntilEmpty.toFixed(1)} days left
                </div>
              </div>
              {a.acknowledgedAt ? (
                <span className="text-xs text-ink-400">acked {new Date(a.acknowledgedAt).toLocaleDateString()}</span>
              ) : (
                <button disabled={busyId === a.id} onClick={() => ack(a.id)} className="ons-btn-ghost text-sm">
                  Acknowledge
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
