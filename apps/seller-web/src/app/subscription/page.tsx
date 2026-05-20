'use client';

import * as React from 'react';
import { Badge, Button, Card, CardDescription, CardTitle, Money } from '@onsective/ui';
import type {
  CurrencyCode,
  SellerSubscriptionDto,
  SubscriptionTier,
  TierDefinitionDto,
} from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const ORDER: SubscriptionTier[] = ['BASIC', 'PRO', 'ENTERPRISE'];

export default function SubscriptionPage() {
  const { user, loading } = useAuth();
  const [tiers, setTiers] = React.useState<TierDefinitionDto[] | null>(null);
  const [mine, setMine] = React.useState<SellerSubscriptionDto | null>(null);
  const [busy, setBusy] = React.useState<SubscriptionTier | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    if (!user) return;
    api.subscriptions.tiers().then(setTiers).catch(() => setTiers([]));
    api.subscriptions.mine().then(setMine).catch(() => setMine(null));
  }, [user]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function upgrade(tier: SubscriptionTier) {
    setBusy(tier);
    setMsg(null);
    try {
      const r = await api.subscriptions.start({ tier, paymentProvider: 'mock' });
      setMsg(r.instant ? `Activated ${tier}` : 'Awaiting payment capture (Stripe)');
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(null); }
  }

  async function cancel() {
    setBusy('BASIC');
    setMsg(null);
    try {
      await api.subscriptions.cancel();
      setMsg('Subscription cancelled — back on BASIC');
      reload();
    } finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!tiers || !mine) return <div className="container py-16 text-ink-400">Loading plans…</div>;

  const tierByCode = new Map(tiers.map((t) => [t.tier, t]));

  return (
    <div className="container py-10 space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Subscription</h1>
        <p className="text-ink-400 text-sm">
          You're on <Badge tone="accent">{mine.tier}</Badge>
          {mine.currentPeriodEnd && (
            <span className="ml-2 text-ink-500">renews {new Date(mine.currentPeriodEnd).toLocaleDateString()}</span>
          )}
        </p>
        {msg && <p className="mt-2 text-success text-sm">{msg}</p>}
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        {ORDER.map((code) => {
          const t = tierByCode.get(code);
          if (!t) return null;
          const isCurrent = mine.tier === t.tier;
          return (
            <Card key={t.tier} className={isCurrent ? 'border-accent-500/50' : ''}>
              <div className="flex items-center justify-between">
                <CardTitle>{t.displayName}</CardTitle>
                {isCurrent && <Badge tone="success">Current</Badge>}
              </div>
              <CardDescription>{t.description}</CardDescription>
              <p className="mt-3 text-2xl font-semibold">
                {t.monthlyPriceMinor === 0 ? 'Free' : <><Money amountMinor={t.monthlyPriceMinor} currency={t.currency as CurrencyCode} /> <span className="text-sm font-normal text-ink-400">/ month</span></>}
              </p>
              <ul className="mt-4 space-y-1 text-sm text-ink-300">
                <li>{t.features.maxActiveProducts === -1 ? 'Unlimited products' : `Up to ${t.features.maxActiveProducts} products`}</li>
                <li>{t.features.bulkImport ? '✓ Bulk import' : '· Bulk import'}</li>
                <li>{t.features.analyticsAdvanced ? '✓ Advanced analytics' : '· Basic analytics'}</li>
                <li>{t.features.variantMatrix ? '✓ Variant matrix editor' : '· Single-variant only'}</li>
                <li>{t.features.listingFeeOverride ? '✓ Listing-fee negotiation' : '· Default listing fees'}</li>
              </ul>
              <div className="mt-5">
                {isCurrent ? (
                  t.tier !== 'BASIC' ? (
                    <Button variant="danger" loading={busy !== null} onClick={cancel} fullWidth>Cancel & downgrade</Button>
                  ) : (
                    <Button variant="ghost" disabled fullWidth>Current plan</Button>
                  )
                ) : (
                  <Button loading={busy === t.tier} onClick={() => upgrade(t.tier)} fullWidth>
                    {t.tier === 'BASIC' ? 'Downgrade' : `Upgrade to ${t.displayName}`}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
