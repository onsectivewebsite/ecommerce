'use client';

import * as React from 'react';
import Link from 'next/link';
import { Money } from '@onsective/ui';
import type { WalletStatement } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function kindLabel(k: string) {
  return k.replace(/_/g, ' ').toLowerCase();
}

export default function WalletPage() {
  const { user, loading } = useAuth();
  const [statement, setStatement] = React.useState<WalletStatement | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.wallet.statement().then(setStatement).catch(() => setStatement(null));
  }, [loading, user]);

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) return <div className="container py-16"><Link href="/login?next=/account/wallet" className="ons-btn-primary">Sign in</Link></div>;
  if (!statement) return <div className="container py-16 text-ink-400">Loading wallet…</div>;

  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Wallet</h1>
      <div className="ons-card mb-6">
        <div className="text-sm text-ink-300">Available balance</div>
        <div className="text-3xl font-display mt-1">
          <Money amountMinor={statement.balanceMinor} currency={statement.currency} emphasized />
        </div>
        <div className="text-xs text-ink-400 mt-2">Balance is applied automatically at checkout (you can choose how much).</div>
      </div>

      <h2 className="font-medium mb-3">Recent activity</h2>
      <div className="space-y-2">
        {statement.transactions.length === 0 ? (
          <p className="text-ink-400 text-sm">No transactions yet.</p>
        ) : statement.transactions.map((t) => (
          <div key={t.id} className="ons-card flex items-center justify-between">
            <div>
              <div className="text-sm capitalize">{kindLabel(t.kind)}</div>
              {t.reason && <div className="text-xs text-ink-400">{t.reason}</div>}
              <div className="text-xs text-ink-500">{new Date(t.createdAt).toLocaleString()}</div>
            </div>
            <div className={t.amountMinor >= 0 ? 'text-success' : 'text-danger'}>
              {t.amountMinor >= 0 ? '+' : ''}
              <Money amountMinor={t.amountMinor} currency={statement.currency} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
