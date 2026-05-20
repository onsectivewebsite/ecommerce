'use client';

import * as React from 'react';
import Link from 'next/link';
import { Money } from '@onsective/ui';
import type { SellerAnalyticsOverview } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const WINDOWS = [7, 30, 90, 180] as const;

function pct(x: number) { return `${(x * 100).toFixed(1)}%`; }

export default function SellerFunnelPage() {
  const { user, loading } = useAuth();
  const [days, setDays] = React.useState<(typeof WINDOWS)[number]>(30);
  const [data, setData] = React.useState<SellerAnalyticsOverview | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    setData(null);
    api.analytics.overview(days).then(setData).catch((e) => setErr(e?.message ?? 'Failed to load'));
  }, [loading, user, days]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (err) return <div className="container py-16 text-danger">{err}</div>;
  if (!data) return <div className="container py-16 text-ink-400">Loading analytics…</div>;

  const maxRevenue = Math.max(1, ...data.aovTrend.map((d) => d.revenueMinor));

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/analytics" className="text-sm text-accent-300 hover:underline">← back to analytics</Link>
          <h1 className="font-display text-3xl tracking-tight mt-1">Funnel & returns</h1>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value) as any)} className="ons-input">
          {WINDOWS.map((w) => <option key={w} value={w}>Last {w} days</option>)}
        </select>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Views" value={data.funnel.VIEW.toLocaleString()} />
        <Stat label="Added to cart" value={data.funnel.ADD_TO_CART.toLocaleString()} sub={pct(data.funnel.viewToAddRate) + ' from views'} />
        <Stat label="Purchases" value={data.funnel.PURCHASE.toLocaleString()} sub={pct(data.funnel.addToPurchaseRate) + ' from cart'} />
        <Stat label="Overall conversion" value={pct(data.funnel.overallConversion)} sub={`${data.orderCount} orders`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="ons-card">
          <h2 className="font-medium mb-3">Revenue trend</h2>
          {data.aovTrend.length === 0 ? (
            <p className="text-ink-400 text-sm">No purchases in this window yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.aovTrend.map((d) => (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <div className="w-20 text-ink-400">{d.date.slice(5)}</div>
                  <div className="flex-1 bg-ink-800/50 rounded-sm h-3 overflow-hidden">
                    <div className="h-full bg-accent-500/70" style={{ width: `${(d.revenueMinor / maxRevenue) * 100}%` }} />
                  </div>
                  <div className="w-24 text-right">
                    <Money amountMinor={d.revenueMinor} currency="USD" />
                  </div>
                  <div className="w-12 text-right text-ink-400">{d.orders}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ons-card">
          <h2 className="font-medium mb-3">Top products by revenue</h2>
          {data.topProducts.length === 0 ? (
            <p className="text-ink-400 text-sm">No purchases yet.</p>
          ) : (
            <div className="space-y-2">
              {data.topProducts.map((p) => (
                <div key={p.productId} className="flex items-center justify-between text-sm">
                  <span className="truncate flex-1">{p.title}</span>
                  <span className="text-ink-400 mx-3">{p.purchases}×</span>
                  <Money amountMinor={p.revenueMinor} currency={p.currency} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ons-card lg:col-span-2">
          <h2 className="font-medium mb-3">Return rate by SKU</h2>
          {data.returnRateBySku.length === 0 ? (
            <p className="text-ink-400 text-sm">No data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-ink-400 text-xs uppercase">
                <tr>
                  <th className="text-left py-2">Product</th>
                  <th className="text-right py-2">Purchases</th>
                  <th className="text-right py-2">Returns</th>
                  <th className="text-right py-2">Return rate</th>
                </tr>
              </thead>
              <tbody>
                {data.returnRateBySku.map((r) => (
                  <tr key={r.productId} className="border-t border-ink-800">
                    <td className="py-2">{r.title}</td>
                    <td className="py-2 text-right">{r.purchases}</td>
                    <td className="py-2 text-right">{r.returns}</td>
                    <td className={[
                      'py-2 text-right',
                      r.returnRate > 0.1 ? 'text-danger' : r.returnRate > 0.05 ? 'text-warning' : 'text-ink-200',
                    ].join(' ')}>
                      {pct(r.returnRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ons-card">
      <div className="text-xs text-ink-400 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-display mt-1">{value}</div>
      {sub && <div className="text-xs text-ink-400 mt-1">{sub}</div>}
    </div>
  );
}
