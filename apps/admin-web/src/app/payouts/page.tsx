'use client';

import * as React from 'react';
import { Badge, Button, Card, CardDescription, CardTitle, Money } from '@onsective/ui';
import type { CurrencyCode, PayoutDto, PayoutStatus } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const toneFor = (s: PayoutStatus) =>
  s === 'PAID' ? 'success' : s === 'FAILED' || s === 'CANCELLED' ? 'danger' : 'accent';

export default function AdminPayoutsPage() {
  const { user, loading } = useAuth();
  const [filter, setFilter] = React.useState<PayoutStatus | 'ALL'>('PENDING');
  const [list, setList] = React.useState<PayoutDto[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    if (!user) return;
    api.payouts.listAdmin(filter === 'ALL' ? undefined : filter).then(setList);
  }, [user, filter]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function runCycle() {
    setBusy('cycle'); setMsg(null);
    try {
      const r = await api.payouts.run();
      setMsg(`Created ${r.created}, skipped ${r.skipped}`);
      reload();
    } finally { setBusy(null); }
  }

  async function execute(p: PayoutDto) {
    setBusy(p.id);
    try { await api.payouts.execute(p.id); reload(); }
    finally { setBusy(null); }
  }

  async function markPaid(p: PayoutDto) {
    const ref = prompt('External reference (bank wire id etc.)') ?? undefined;
    setBusy(p.id);
    try { await api.payouts.markPaid(p.id, ref); reload(); }
    finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Payouts</h1>
          <p className="text-ink-400 text-sm">Compute seller balances, transfer via Stripe Connect or mark off-platform manual payouts.</p>
        </div>
        <Button loading={busy === 'cycle'} onClick={runCycle}>Run payout cycle</Button>
      </header>

      {msg && (
        <Card>
          <CardTitle>Result</CardTitle>
          <CardDescription>{msg}</CardDescription>
        </Card>
      )}

      <div className="flex gap-1">
        {(['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'ALL'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={[
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              filter === s ? 'bg-ink-800 text-ink-50' : 'text-ink-400 hover:bg-ink-800/60',
            ].join(' ')}
          >{s}</button>
        ))}
      </div>

      {!list ? <p className="text-ink-400">Loading…</p> : list.length === 0 ? (
        <p className="text-ink-400">No payouts in this view.</p>
      ) : (
        <div className="ons-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-ink-400">
              <tr>
                <th className="text-left p-3">Seller</th>
                <th className="text-left p-3">Method</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Period</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p: any) => (
                <tr key={p.id} className="border-t border-ink-800">
                  <td className="p-3">
                    <div className="font-medium">{p.seller?.displayName ?? p.sellerId.slice(-8)}</div>
                    <div className="text-xs text-ink-400">{p.seller?.storeName ?? p.sellerId}</div>
                  </td>
                  <td className="p-3">{p.method}</td>
                  <td className="p-3"><Badge tone={toneFor(p.status)}>{p.status}</Badge></td>
                  <td className="p-3 text-ink-300">{new Date(p.periodStart).toLocaleDateString()} → {new Date(p.periodEnd).toLocaleDateString()}</td>
                  <td className="p-3 text-right"><Money amountMinor={p.amountMinor} currency={p.currency as CurrencyCode} emphasized /></td>
                  <td className="p-3 text-right space-x-2">
                    {p.status === 'PENDING' && (
                      <Button size="sm" loading={busy === p.id} onClick={() => execute(p)}>Execute</Button>
                    )}
                    {(p.status === 'PROCESSING' || p.status === 'PENDING') && (
                      <Button size="sm" variant="secondary" loading={busy === p.id} onClick={() => markPaid(p)}>Mark paid</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
