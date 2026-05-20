'use client';

import * as React from 'react';
import Link from 'next/link';
import { Money } from '@onsective/ui';
import type { PointsStatement } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function kindLabel(k: string) {
  return k.replace(/_/g, ' ').toLowerCase();
}

export default function PointsPage() {
  const { user, loading } = useAuth();
  const [stmt, setStmt] = React.useState<PointsStatement | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [amount, setAmount] = React.useState('100');
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const s = await api.loyalty.pointsStatement();
      setStmt(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    void reload();
  }, [loading, user, reload]);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSuccess(null);
    try {
      const pts = Number(amount);
      const r = await api.loyalty.redeemPoints({ points: pts });
      setSuccess(`Redeemed ${pts} pts for $${(r.walletCreditedMinor / 100).toFixed(2)} wallet credit.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16">
        <Link href="/login?next=/account/points" className="ons-btn-primary">Sign in</Link>
      </div>
    );
  }
  if (!stmt) return <div className="container py-16 text-ink-400">Loading points…</div>;

  const max = Math.floor(stmt.balance / 100) * 100;

  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Points</h1>

      <div className="ons-card mb-6">
        <div className="text-sm text-ink-300">Available balance</div>
        <div className="text-3xl font-display mt-1">{stmt.balance.toLocaleString()} pts</div>
        <div className="text-xs text-ink-400 mt-2">
          100 pts = $1.00 wallet credit. Min redemption 100 pts, multiples of 100.
        </div>
      </div>

      <div className="ons-card mb-6">
        <h2 className="font-medium mb-3">Redeem to wallet</h2>
        {max < 100 ? (
          <p className="text-ink-400 text-sm">Earn at least 100 points to start redeeming.</p>
        ) : (
          <form onSubmit={redeem} className="flex flex-wrap gap-3 items-end">
            <label className="block">
              <span className="text-xs text-ink-300">Points to redeem</span>
              <input
                type="number"
                min={100}
                step={100}
                max={max}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="ons-input mt-1 w-40"
              />
            </label>
            <div className="text-sm text-ink-300">
              ≈ <Money amountMinor={Number(amount) || 0} currency="USD" emphasized />
            </div>
            <button type="submit" disabled={busy} className="ons-btn-primary">
              {busy ? 'Redeeming…' : 'Redeem'}
            </button>
          </form>
        )}
        {error && <div className="text-danger text-sm mt-3">{error}</div>}
        {success && <div className="text-success text-sm mt-3">{success}</div>}
      </div>

      <h2 className="font-medium mb-3">Activity</h2>
      <div className="space-y-2">
        {stmt.transactions.length === 0 ? (
          <p className="text-ink-400 text-sm">No points activity yet — make a purchase to start earning.</p>
        ) : stmt.transactions.map((t) => (
          <div key={t.id} className="ons-card flex items-center justify-between">
            <div>
              <div className="text-sm capitalize">{kindLabel(t.kind)}</div>
              {t.reason && <div className="text-xs text-ink-400">{t.reason}</div>}
              <div className="text-xs text-ink-500">{new Date(t.createdAt).toLocaleString()}</div>
            </div>
            <div className={t.amount >= 0 ? 'text-success' : 'text-danger'}>
              {t.amount >= 0 ? '+' : ''}{t.amount.toLocaleString()} pts
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
