'use client';

import * as React from 'react';
import { Badge, Money } from '@onsective/ui';
import type { CurrencyCode, PayoutDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const toneFor = (s: PayoutDto['status']) =>
  s === 'PAID' ? 'success' : s === 'FAILED' || s === 'CANCELLED' ? 'danger' : 'accent';

export default function PayoutsPage() {
  const { user, loading } = useAuth();
  const [list, setList] = React.useState<PayoutDto[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.payouts.mine().then(setList).catch(() => setList([]));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 space-y-4">
      <h1 className="font-display text-3xl tracking-tight">Payouts</h1>
      {!list ? <p className="text-ink-400">Loading…</p> : list.length === 0 ? (
        <p className="text-ink-400">No payouts yet. They appear after the admin runs the periodic computation.</p>
      ) : (
        <div className="ons-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-ink-400">
              <tr>
                <th className="text-left p-3">Period</th>
                <th className="text-left p-3">Method</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-right p-3">Ref</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-t border-ink-800">
                  <td className="p-3 text-ink-300">
                    {new Date(p.periodStart).toLocaleDateString()} → {new Date(p.periodEnd).toLocaleDateString()}
                  </td>
                  <td className="p-3">{p.method}</td>
                  <td className="p-3"><Badge tone={toneFor(p.status)}>{p.status}</Badge></td>
                  <td className="p-3 text-right"><Money amountMinor={p.amountMinor} currency={p.currency as CurrencyCode} /></td>
                  <td className="p-3 text-right text-xs text-ink-400">{p.externalRef ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
