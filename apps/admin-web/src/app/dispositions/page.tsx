'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { PendingReturnRow, ReturnInspectionRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminDispositionsPage() {
  const { user, loading } = useAuth();
  const [pending, setPending] = React.useState<PendingReturnRow[] | null>(null);
  const [recent, setRecent] = React.useState<ReturnInspectionRow[]>([]);

  React.useEffect(() => {
    if (loading || !user) return;
    api.returnsDisposition.adminPending().then(setPending).catch(() => setPending([]));
    api.returnsDisposition.adminRecent(100).then(setRecent).catch(() => setRecent([]));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!pending) return <div className="container py-16 text-ink-400">Loading dispositions…</div>;

  const counts: Record<string, number> = {};
  for (const r of recent) {
    counts[r.disposition] = (counts[r.disposition] ?? 0) + 1;
  }

  return (
    <div className="container py-10 space-y-10">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Return dispositions</h1>
        <p className="text-sm text-ink-400 mt-1">
          Returns waiting for a physical disposition + the most recent decisions.
        </p>
      </header>

      <section>
        <h2 className="font-medium mb-3">Pending ({pending.length})</h2>
        {pending.length === 0 ? <p className="text-ink-400">All caught up.</p> : (
          <div className="space-y-1">
            {pending.map((r) => (
              <div key={r.id} className="ons-card flex items-center gap-3 text-sm">
                <Badge tone="warning">{r.status}</Badge>
                <code className="text-xs text-ink-400">{r.id.slice(-10)}</code>
                <span className="flex-1">
                  {r.items.map((i) => i.orderItem.productTitleSnapshot).join(', ') || '—'}
                </span>
                <span className="text-xs text-ink-500">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-3">Recent dispositions ({recent.length})</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {(['OUTLET_RELIST', 'REFURB_REGRADE', 'DISPOSE', 'RETURN_TO_SELLER'] as const).map((d) => (
            <div key={d} className="ons-card text-center">
              <p className="text-xs uppercase tracking-wider text-ink-400">{d.replace(/_/g, ' ').toLowerCase()}</p>
              <p className="text-2xl font-display mt-1">{counts[d] ?? 0}</p>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {recent.map((r) => (
            <div key={r.id} className="ons-card flex items-center gap-3 text-xs">
              <Badge tone={
                r.disposition === 'OUTLET_RELIST' ? 'success'
                : r.disposition === 'DISPOSE' ? 'danger'
                : 'neutral'
              }>{r.disposition}</Badge>
              <code className="text-ink-400">{r.returnId.slice(-10)}</code>
              {r.outletDiscountBps != null && <span className="text-emerald-300">{Math.round(r.outletDiscountBps / 100)}% off</span>}
              {r.disposeReason && <span className="text-danger truncate max-w-xs">{r.disposeReason}</span>}
              <span className="flex-1 text-ink-300 truncate">{r.conditionNotes ?? ''}</span>
              <span className="text-ink-500">{new Date(r.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
