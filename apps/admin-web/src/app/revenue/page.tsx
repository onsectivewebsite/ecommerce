'use client';

import * as React from 'react';
import { Card, CardDescription, CardTitle, Money } from '@onsective/ui';
import type { CurrencyCode, PlatformRevenueDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function RevenuePage() {
  const { user, loading } = useAuth();
  const [range, setRange] = React.useState(30);
  const [snap, setSnap] = React.useState<PlatformRevenueDto | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    setSnap(null);
    api.revenue.snapshot(range).then(setSnap).catch(() => setSnap(null));
  }, [loading, user, range]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!snap) return <div className="container py-16 text-ink-400">Loading revenue…</div>;
  const currency = snap.currency as CurrencyCode;
  const takeRatePct = (snap.takeRateBps / 100).toFixed(2);

  return (
    <div className="container py-10 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl tracking-tight">Revenue</h1>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setRange(d)}
              className={[
                'rounded-lg px-3 py-1.5 text-sm transition-colors',
                range === d ? 'bg-ink-800 text-ink-50' : 'text-ink-400 hover:bg-ink-800/60',
              ].join(' ')}
            >Last {d}d</button>
          ))}
        </div>
      </header>

      <div className="grid md:grid-cols-4 gap-4">
        <Card>
          <CardDescription>GMV</CardDescription>
          <p className="mt-1 text-2xl font-semibold"><Money amountMinor={snap.gmvMinor} currency={currency} /></p>
          <p className="text-xs text-ink-400 mt-1">{snap.orderCount} orders</p>
        </Card>
        <Card>
          <CardDescription>Commission</CardDescription>
          <p className="mt-1 text-2xl font-semibold text-gold-400"><Money amountMinor={snap.commissionMinor} currency={currency} /></p>
          <p className="text-xs text-ink-400 mt-1">Take rate {takeRatePct}%</p>
        </Card>
        <Card>
          <CardDescription>Ad revenue (lifetime)</CardDescription>
          <p className="mt-1 text-2xl font-semibold text-accent-300"><Money amountMinor={snap.adRevenueMinor} currency={currency} /></p>
        </Card>
        <Card>
          <CardDescription>Owed to sellers (ledger)</CardDescription>
          <p className="mt-1 text-2xl font-semibold"><Money amountMinor={snap.sellerPayableTotalMinor} currency={currency} /></p>
          <p className="text-xs text-ink-400 mt-1">Paid out: <Money amountMinor={snap.payoutsSentTotalMinor} currency={currency} /></p>
        </Card>
      </div>

      <Card>
        <CardTitle>Notes</CardTitle>
        <CardDescription>
          GMV / commission are from the selected range. Ad revenue and ledger totals are lifetime. Run
          the payouts cycle from the Payouts tab to convert seller payable balances into Payout rows.
        </CardDescription>
      </Card>
    </div>
  );
}
