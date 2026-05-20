'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Money } from '@onsective/ui';
import type { TradeInOrderRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function BuyerTradeInsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<TradeInOrderRow[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.tradeIn.mine().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function cancel(id: string) {
    if (!confirm('Cancel this trade-in?')) return;
    setBusy(id);
    try { await api.tradeIn.cancel(id); load(); } finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading trade-ins…</div>;

  const tone = (s: TradeInOrderRow['status']) =>
    s === 'PAID' ? 'success' as const
    : s === 'REJECTED' || s === 'CANCELLED' ? 'danger' as const
    : 'warning' as const;

  return (
    <div className="container py-10 max-w-3xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">My trade-ins</h1>
          <p className="text-sm text-ink-400 mt-1">Status and payouts for every device you've sent in.</p>
        </div>
        <Link href="/trade-in" className="ons-btn-primary text-sm">+ Start a new trade-in</Link>
      </header>

      {rows.length === 0 ? (
        <p className="text-ink-400">No trade-ins yet. Try <Link href="/trade-in" className="underline">trading in a device</Link>.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((o) => (
            <div key={o.id} className="ons-card">
              <div className="flex items-start gap-3 flex-wrap">
                <Badge tone={tone(o.status)}>{o.status}</Badge>
                <div className="flex-1 min-w-[200px]">
                  <p className="font-medium">{o.model?.sourceProduct?.title ?? 'Trade-in'}</p>
                  <p className="text-xs text-ink-400 mt-1">
                    Declared {o.declaredGrade.replace('GRADE_', 'Grade ')}
                    {o.actualGrade ? ` · Graded ${o.actualGrade.replace('GRADE_', 'Grade ')}` : ''}
                    {' · '}
                    Offer <Money amountMinor={o.offerMinor} currency={o.currency as 'USD'} />
                  </p>
                  {o.finalPayoutMinor != null && o.finalPayoutMinor !== o.offerMinor && (
                    <p className="text-xs text-ink-500 mt-1">
                      Final payout: <Money amountMinor={o.finalPayoutMinor} currency={o.currency as 'USD'} />
                    </p>
                  )}
                  {o.shipBackLabelUrl && o.status === 'KIT_SHIPPED' && (
                    <a href={o.shipBackLabelUrl} target="_blank" rel="noreferrer"
                       className="text-xs underline text-gold-400 mt-1 inline-block">Download ship-back label</a>
                  )}
                  {o.rejectionReason && (
                    <p className="text-xs text-danger mt-1">Rejected: {o.rejectionReason}</p>
                  )}
                  {o.refurbUnitId && (
                    <p className="text-xs text-emerald-300 mt-1">Listed for sale ↗ unit {o.refurbUnitId.slice(-8)}</p>
                  )}
                </div>
                {['CREATED', 'KIT_SHIPPED', 'IN_TRANSIT'].includes(o.status) && (
                  <button disabled={busy === o.id} onClick={() => cancel(o.id)} className="ons-btn-ghost text-xs">
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
