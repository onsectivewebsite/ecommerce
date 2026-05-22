'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Money } from '@onsective/ui';
import type { CurrencyCode } from '@onsective/shared-types';
import type { ProductSubscriptionRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const INTERVALS = [
  { days: 30, label: 'Every month' },
  { days: 60, label: 'Every 2 months' },
  { days: 90, label: 'Every 3 months' },
];

function statusTone(s: string): 'success' | 'warning' | 'danger' {
  if (s === 'ACTIVE') return 'success';
  if (s === 'PAUSED') return 'warning';
  return 'danger';
}

export default function SubscriptionsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<ProductSubscriptionRow[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.autoship.list().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try { await fn(); load(); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">My subscriptions</h1>
      {!rows ? <p className="text-ink-400">Loading…</p> :
       rows.length === 0 ? (
         <p className="text-ink-400">
           You have no subscriptions. Look for <span className="text-accent-300">Subscribe &amp; Save</span> on a product page.
         </p>
       ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <div key={s.id} className="ons-card">
              <div className="flex items-center justify-between">
                <Link href={`/p/${s.product.slug}`} className="text-accent-300">{s.product.title}</Link>
                <Badge tone={statusTone(s.status)}>{s.status}</Badge>
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-ink-300">
                <Money amountMinor={s.discountedUnitMinor} currency={s.currency as CurrencyCode} />
                <span className="text-ink-500 line-through">
                  <Money amountMinor={s.unitPriceMinor} currency={s.currency as CurrencyCode} />
                </span>
                <span className="text-ink-500">· qty {s.qty}</span>
              </div>
              <p className="text-xs text-ink-500 mt-1">
                {s.status === 'ACTIVE'
                  ? `Next delivery ${new Date(s.nextRunAt).toLocaleDateString()}${s.skipNextRun ? ' (next cycle skipped)' : ''}`
                  : s.status === 'PAUSED' ? 'Paused' : 'Cancelled'}
                {s.lastRunStatus && s.lastRunStatus !== 'SUCCESS' && s.status !== 'CANCELLED'
                  ? ` · last run: ${s.lastRunStatus}` : ''}
              </p>

              {s.status !== 'CANCELLED' && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={s.intervalDays}
                    disabled={busyId === s.id}
                    onChange={(e) => act(s.id, () => api.autoship.update(s.id, { intervalDays: Number(e.target.value) }))}
                    className="ons-input text-sm"
                    aria-label="Delivery frequency"
                  >
                    {INTERVALS.map((i) => <option key={i.days} value={i.days}>{i.label}</option>)}
                  </select>
                  {s.status === 'ACTIVE' && !s.skipNextRun && (
                    <button disabled={busyId === s.id} onClick={() => act(s.id, () => api.autoship.skip(s.id))} className="ons-btn-ghost text-sm">Skip next</button>
                  )}
                  {s.status === 'ACTIVE' && (
                    <button disabled={busyId === s.id} onClick={() => act(s.id, () => api.autoship.pause(s.id))} className="ons-btn-ghost text-sm">Pause</button>
                  )}
                  {s.status === 'PAUSED' && (
                    <button disabled={busyId === s.id} onClick={() => act(s.id, () => api.autoship.resume(s.id))} className="ons-btn-ghost text-sm">Resume</button>
                  )}
                  <button disabled={busyId === s.id} onClick={() => { if (confirm('Cancel this subscription?')) act(s.id, () => api.autoship.cancel(s.id)); }} className="ons-btn-ghost text-sm text-danger">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
