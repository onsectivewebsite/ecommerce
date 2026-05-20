'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { BuyerLifetimeResult } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const SUBJECT_LABEL: Record<string, string> = {
  REFURB_PURCHASE: 'Refurbished purchase',
  OPENBOX_PURCHASE: 'Open-box purchase',
  TRADEIN_PAYOUT: 'Trade-in',
  REPAIR_COMPLETED: 'Repair',
};

export default function BuyerImpactPage() {
  const { user, loading } = useAuth();
  const [data, setData] = React.useState<BuyerLifetimeResult | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.sustainability.mine().then(setData).catch(() => setData({ totals: { kgCo2Saved: 0, kgMaterialDiverted: 0, lifeExtensionYears: 0, events: 0 }, recent: [] }));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!data) return <div className="container py-16 text-ink-400">Loading impact…</div>;

  const shareText = `I've avoided ${data.totals.kgCo2Saved.toFixed(0)} kg of CO₂ buying certified through Onsective.`;
  const shareLink = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div className="container py-12 max-w-3xl space-y-10">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Your impact</h1>
        <p className="text-sm text-ink-400 mt-2">
          A running tally of the circular actions you've made on Onsective. Each event
          is recorded with a snapshotted estimate at the moment it happened.
        </p>
      </header>

      <section className="grid sm:grid-cols-3 gap-4">
        <StatCard label="kg CO₂ avoided" value={fmt(data.totals.kgCo2Saved, 0)} />
        <StatCard label="kg material diverted" value={fmt(data.totals.kgMaterialDiverted, 2)} />
        <StatCard label="years of product life added" value={fmt(data.totals.lifeExtensionYears, 1)} />
      </section>

      <section className="ons-card">
        <h2 className="font-medium mb-2">Share your impact</h2>
        <p className="text-xs text-ink-400 mb-3">Copy the text — share it however you want.</p>
        <textarea readOnly value={`${shareText}\n${shareLink}`} className="ons-input min-h-[80px] text-sm font-mono" />
      </section>

      <section>
        <h2 className="font-medium mb-3">Recent activity</h2>
        {data.recent.length === 0 ? (
          <p className="text-ink-400">No impact yet. Try a certified refurbished purchase, a trade-in, or the outlet — every circular action counts here.</p>
        ) : (
          <div className="space-y-2">
            {data.recent.map((r) => (
              <div key={r.id} className="ons-card flex items-center gap-3 text-sm">
                <Badge tone="neutral">{SUBJECT_LABEL[r.subjectKind] ?? r.subjectKind}</Badge>
                <div className="flex-1">
                  <p className="text-ink-200">{r.reason ?? r.subjectKind}</p>
                  <p className="text-xs text-ink-500 mt-1">{new Date(r.createdAt).toLocaleDateString()} · {r.categorySlug}</p>
                </div>
                <span className="font-display text-base">{fmt(r.kgCo2Saved, 1)} kg CO₂</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="ons-card text-center">
      <p className="text-xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className="font-display text-3xl mt-2">{value}</p>
    </div>
  );
}

function fmt(n: number, decimals: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}
