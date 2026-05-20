'use client';

import * as React from 'react';
import { Badge, Card, CardDescription, CardTitle, Money } from '@onsective/ui';
import type {
  AnalyticsRange,
  AnalyticsSummaryDto,
  CurrencyCode,
  TopSkuDto,
} from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AnalyticsPage() {
  const { user, loading } = useAuth();
  const [range, setRange] = React.useState<AnalyticsRange>('30d');
  const [summary, setSummary] = React.useState<AnalyticsSummaryDto | null>(null);
  const [top, setTop] = React.useState<TopSkuDto[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    setSummary(null); setTop(null);
    api.seller.analyticsSummary(range).then(setSummary).catch(() => setSummary(null));
    api.seller.analyticsTopSkus(range, 10).then(setTop).catch(() => setTop([]));
  }, [loading, user, range]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  const currency = (summary?.currency ?? 'USD') as CurrencyCode;

  return (
    <div className="container py-10 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl tracking-tight">Analytics</h1>
        <div className="flex items-center gap-3">
          <a href="/analytics/funnel" className="text-sm text-accent-300 hover:underline">Funnel & returns →</a>
          <div className="flex gap-1">
            {(['7d', '30d', '90d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={[
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  range === r ? 'bg-ink-800 text-ink-50' : 'text-ink-400 hover:bg-ink-800/60',
                ].join(' ')}
              >Last {r}</button>
            ))}
          </div>
        </div>
      </header>

      {!summary ? (
        <Card><CardTitle>Loading…</CardTitle></Card>
      ) : (
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardDescription>Gross revenue</CardDescription>
            <p className="mt-1 text-2xl font-semibold"><Money amountMinor={summary.grossMinor} currency={currency} /></p>
          </Card>
          <Card>
            <CardDescription>Seller net</CardDescription>
            <p className="mt-1 text-2xl font-semibold text-success"><Money amountMinor={summary.netSellerMinor} currency={currency} /></p>
            <p className="text-xs text-ink-400 mt-1">After commission</p>
          </Card>
          <Card>
            <CardDescription>Orders</CardDescription>
            <p className="mt-1 text-2xl font-semibold">{summary.orderCount}</p>
            <p className="text-xs text-ink-400 mt-1">{summary.refundedCount} refunded</p>
          </Card>
          <Card>
            <CardDescription>AOV</CardDescription>
            <p className="mt-1 text-2xl font-semibold"><Money amountMinor={summary.aovMinor} currency={currency} /></p>
          </Card>
        </div>
      )}

      <Card>
        <CardTitle>Top SKUs</CardTitle>
        <CardDescription>By revenue, {range}</CardDescription>
        {!top ? (
          <p className="text-ink-400 mt-3">Loading…</p>
        ) : top.length === 0 ? (
          <p className="text-ink-400 mt-3">No sales in this window.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="text-ink-400">
              <tr>
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">SKU</th>
                <th className="text-left p-2">Product</th>
                <th className="text-right p-2">Units</th>
                <th className="text-right p-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {top.map((s, idx) => (
                <tr key={s.variantId} className="border-t border-ink-800">
                  <td className="p-2 text-ink-400">{idx + 1}</td>
                  <td className="p-2 font-mono text-xs">{s.sku}</td>
                  <td className="p-2">{s.productTitle} <span className="text-ink-500">{s.variantName}</span></td>
                  <td className="p-2 text-right">{s.unitsSold}</td>
                  <td className="p-2 text-right"><Money amountMinor={s.revenueMinor} currency={currency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
