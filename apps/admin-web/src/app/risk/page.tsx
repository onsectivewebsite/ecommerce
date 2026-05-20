'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Money } from '@onsective/ui';
import type { OrderHoldRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function severityTone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 90) return 'danger';
  if (score >= 60) return 'warning';
  return 'success';
}

export default function RiskQueuePage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<OrderHoldRow[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.risk.queue().then(setRows).catch(() => setRows([]));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading queue…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">Risk review queue</h1>
      {rows.length === 0 ? (
        <p className="text-ink-400">Nothing on hold.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((h) => (
            <Link key={h.id} href={`/risk/${h.orderId}`} className="ons-card flex items-center gap-4 hover:border-accent-500/40 transition-colors">
              <div className="flex-1">
                <div className="text-xs text-ink-400">Order #{h.order.id.slice(-8)} · opened {new Date(h.createdAt).toLocaleString()}</div>
                <div className="text-sm font-medium">{h.reason}</div>
              </div>
              <Money amountMinor={h.order.totalMinor} currency={h.order.currency} />
              {h.order.riskAssessment && (
                <Badge tone={severityTone(h.order.riskAssessment.score)}>
                  score {h.order.riskAssessment.score}
                </Badge>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
