'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { SellerHealthOverview } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function tone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'danger';
}

export default function SellerHealthPage() {
  const { user, loading } = useAuth();
  const [data, setData] = React.useState<SellerHealthOverview | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.health.mine().then(setData).catch(() => setData(null));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!data) return <div className="container py-16 text-ink-400">Loading health…</div>;

  const latest = data.latest;
  const maxScore = Math.max(100, ...data.trend.map((t) => t.score));

  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Account health</h1>
      {!latest ? (
        <p className="text-ink-400">No snapshot yet — first one runs tonight.</p>
      ) : (
        <>
          <div className="ons-card mb-6 flex items-center gap-6">
            <div>
              <div className="text-xs text-ink-400 uppercase tracking-wider">Current score</div>
              <div className="text-5xl font-display mt-1">{latest.score}/100</div>
            </div>
            <div className="flex-1 space-y-1">
              <Badge tone={tone(latest.score)}>
                {latest.score >= 70 ? 'Healthy' : latest.score >= 40 ? 'At risk' : 'Below threshold'}
              </Badge>
              <Badge tone={data.sellerStatus === 'APPROVED' ? 'success' : 'danger'}>{data.sellerStatus}</Badge>
              <div className="text-xs text-ink-400 mt-2">
                Computed over {latest.windowDays} days · {latest.ordersConsidered} orders
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            <Metric label="Dispute rate" value={`${(latest.disputeRate * 100).toFixed(1)}%`} bad={latest.disputeRate > 0.05} />
            <Metric label="Chargeback rate" value={`${(latest.chargebackRate * 100).toFixed(2)}%`} bad={latest.chargebackRate > 0.01} />
            <Metric label="Return rate" value={`${(latest.returnRate * 100).toFixed(1)}%`} bad={latest.returnRate > 0.15} />
            <Metric label="SLA-breach rate" value={`${(latest.slaBreachRate * 100).toFixed(1)}%`} bad={latest.slaBreachRate > 0.1} />
          </div>

          {latest.reasons.length > 0 && (
            <div className="ons-card mb-6 border-warning/40 bg-warning/10">
              <h2 className="font-medium mb-2">Focus areas</h2>
              <ul className="list-disc pl-5 text-sm text-ink-200">
                {latest.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          <div className="ons-card">
            <h2 className="font-medium mb-3">Last 30 days</h2>
            <div className="space-y-1.5">
              {data.trend.map((t) => (
                <div key={t.date} className="flex items-center gap-2 text-xs">
                  <div className="w-20 text-ink-400">{t.date.slice(5)}</div>
                  <div className="flex-1 bg-ink-800/50 rounded-sm h-3 overflow-hidden">
                    <div
                      className={[
                        'h-full',
                        t.score >= 70 ? 'bg-success/70' :
                        t.score >= 40 ? 'bg-warning/70' :
                        'bg-danger/70',
                      ].join(' ')}
                      style={{ width: `${(t.score / maxScore) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-right">{t.score}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, bad }: { label: string; value: string; bad: boolean }) {
  return (
    <div className="ons-card">
      <div className="text-xs text-ink-400 uppercase tracking-wider">{label}</div>
      <div className={['text-2xl font-display mt-1', bad ? 'text-danger' : 'text-ink-100'].join(' ')}>{value}</div>
    </div>
  );
}
